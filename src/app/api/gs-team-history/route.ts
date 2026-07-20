import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import {
  computeTeamForm,
  computeMatchup,
  type GsTeamHistoryRow,
  type TeamFormBlock,
  type Tier,
  type MatchupRow,
  type MatchupResponse,
} from '../../../lib/teamForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-export the row type so existing consumers (GSLive) keep importing it here.
export type { GsTeamHistoryRow };

// Response shape: superset of the v1 (`team`/`matches`) and v2 (`n`/`teams`)
// branches. v1 callers (GSLive history tab, no `?v=2`) read `.matches`; the new
// "Quy luật phong độ" view passes `?v=2` and reads `.teams`.
export interface GsTeamHistoryResponse {
  ok: boolean;
  error?: string;
  team?: string;                 // v1: echo of the resolved query team
  matches?: GsTeamHistoryRow[];  // v1: last-10 rows for one team
  n?: number;                    // v2: echo requested n
  teams?: TeamFormBlock[];       // v2: 1 block if team filter set, else all
}

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set (graceful fallback like gs-bets)
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// Vietnamese/alternate → canonical English (same map as gs-team-analysis).
// Only used by the v1 branch's resolveTeamId. The v2 branch matches on the
// team text directly (gs_matches_history.home_team already carries "(V)"/"(S)").
const VN_TO_EN: Record<string, string> = {
  'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
  'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Ả Rập Xê Út': 'Saudi Arabia',
  'Ả Rập Saudi': 'Saudi Arabia', 'Úc': 'Australia', 'Ấn Độ': 'India',
  'Campuchia': 'Cambodia', 'Lào': 'Laos', 'Nga': 'Russia', 'Đức': 'Germany',
  'Pháp': 'France', 'Tây Ban Nha': 'Spain', 'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium', 'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden', 'Na Uy': 'Norway', 'Áo': 'Austria', 'Ý': 'Italy',
  'Anh': 'England', 'Maroc': 'Morocco', 'Mỹ': 'USA',
  'Viet Nam': 'Vietnam', 'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic', 'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea', 'IR Iran': 'Iran', 'Islamic Republic of Iran': 'Iran',
  'Brunei Darussalam': 'Brunei',
};

/** Resolve raw team name (may be VN or alternate English) with "(V)"/"(S)" suffix → gs_teams.id */
async function resolveTeamId(db: Pool, name: string): Promise<number | null> {
  const m = name.trim().match(/^(.+?)\s+\(([VS])\)$/);
  if (!m) return null;
  const base = VN_TO_EN[m[1].trim()] ?? m[1].trim();
  const type = m[2];
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM gs_teams WHERE name = $1 AND type = $2',
    [base, type],
  );
  return rows[0]?.id ?? null;
}

const OFFSET_MS = 7 * 60 * 60 * 1000; // GMT+7

function fmtTime(matchTime: string | Date): string {
  const d = new Date(new Date(matchTime).getTime() + OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function normMatchType(raw: string | null): string {
  if (!raw) return '';
  if (raw === '20p' || raw === '16p') return raw;
  if (/20/.test(raw)) return '20p';
  if (/16/.test(raw)) return '16p';
  return raw;
}

// ── v2: normalize match_time to Vietnam-local UTC-hour for slot math parity ──

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsTeamHistoryResponse);

  const sp = req.nextUrl.searchParams;

  // ── v2 branch: form-rule report ────────────────────────────────────────
  if (sp.get('v') === '2') {
    if (sp.get('mode') === 'matchup') {
      return handleMatchup(pool, sp.get('teamA') ?? '', sp.get('teamB') ?? '');
    }
    return handleV2(pool, sp.get('team') ?? '', sp.get('n'));
  }

  // ── v1 branch (unchanged behaviour — GSLive history tab) ───────────────
  const team = sp.get('team') ?? '';
  if (!team) return Response.json({ ok: false, error: 'missing team' } satisfies GsTeamHistoryResponse);

  try {
    const teamId = await resolveTeamId(pool, team);
    if (!teamId)
      return Response.json({ ok: false, error: `Team not found: ${team}` } satisfies GsTeamHistoryResponse);

    const { rows } = await pool.query(
      `SELECT match_time, match_type, home_team_id, away_team_id,
              ht.name || ' (' || ht.type || ')' AS home_team,
              at.name || ' (' || at.type || ')' AS away_team,
              h1_home, h1_away, tt_home, tt_away
       FROM gs_matches_history mh
       JOIN gs_teams ht ON ht.id = mh.home_team_id
       JOIN gs_teams at ON at.id = mh.away_team_id
       WHERE (mh.home_team_id = $1 OR mh.away_team_id = $1)
         AND mh.tt_home IS NOT NULL
       ORDER BY match_time DESC
       LIMIT 10`,
      [teamId],
    );

    const matches: GsTeamHistoryRow[] = rows.map((r) => {
      const isHome = r.home_team_id === teamId;
      return {
        time: fmtTime(r.match_time),
        opponent: (isHome ? r.away_team : r.home_team) as string,
        league: '',
        isHome,
        matchType: normMatchType(r.match_type),
        h1: isHome
          ? [Number(r.h1_home), Number(r.h1_away)]
          : [Number(r.h1_away), Number(r.h1_home)],
        ft: isHome
          ? [Number(r.tt_home), Number(r.tt_away)]
          : [Number(r.tt_away), Number(r.tt_home)],
      };
    });

    return Response.json({ ok: true, team, matches } satisfies GsTeamHistoryResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsTeamHistoryResponse);
  }
}

// ── v2 implementation ──────────────────────────────────────────────────────

interface HistDbRow {
  match_time: string;
  match_type: string | null;
  league: string | null;
  home_team: string;
  away_team: string;
  h1_home: number; h1_away: number;
  tt_home: number; tt_away: number;
}

/** Build newest-first team-perspective rows for one team from DB rows. */
function toPerspectiveRows(dbRows: HistDbRow[], teamName: string): GsTeamHistoryRow[] {
  return dbRows.map((r) => {
    const isHome = r.home_team === teamName;
    return {
      time: fmtTime(r.match_time),
      opponent: isHome ? r.away_team : r.home_team,
      league: r.league ?? '',
      isHome,
      matchType: normMatchType(r.match_type),
      h1: isHome
        ? [Number(r.h1_home), Number(r.h1_away)]
        : [Number(r.h1_away), Number(r.h1_home)],
      ft: isHome
        ? [Number(r.tt_home), Number(r.tt_away)]
        : [Number(r.tt_away), Number(r.tt_home)],
    };
  });
}

async function handleV2(pool: Pool, teamFilter: string, nRaw: string | null) {
  const n = nRaw === '100' ? 100 : 20;
  try {
    // Per-team global tier / win% from gs_team_profile (fixed strength band).
    const tierByTeam = new Map<string, { tier: Tier; winPct: number }>();
    {
      const { rows } = await pool.query<{ team_name: string; tier: string | null; win_pct: string | null }>(
        `SELECT team_name, tier, win_pct FROM gs_team_profile WHERE tier IS NOT NULL`,
      );
      for (const r of rows) {
        const t = (r.tier === 'strong' || r.tier === 'weak' ? r.tier : 'mid') as Tier;
        tierByTeam.set(r.team_name, { tier: t, winPct: (Number(r.win_pct) || 0) * 100 });
      }
    }

    // Which teams to build blocks for.
    let teamNames: string[];
    if (teamFilter) {
      teamNames = [teamFilter];
    } else {
      const { rows } = await pool.query<{ team: string }>(
        `SELECT team, cnt FROM (
           SELECT team, count(*) cnt FROM (
             SELECT home_team AS team FROM gs_matches_history WHERE tt_home IS NOT NULL
             UNION ALL
             SELECT away_team AS team FROM gs_matches_history WHERE tt_home IS NOT NULL
           ) u GROUP BY team
         ) c ORDER BY cnt DESC`,
      );
      teamNames = rows.map((r) => r.team);
    }

    const blocks: TeamFormBlock[] = [];
    const CHUNK = 10;
    for (let i = 0; i < teamNames.length; i += CHUNK) {
      const slice = teamNames.slice(i, i + CHUNK);
      const results = await Promise.all(
        slice.map(async (name) => {
          const { rows } = await pool.query<HistDbRow>(
            `SELECT match_time, match_type, league, home_team, away_team,
                    h1_home, h1_away, tt_home, tt_away
             FROM gs_matches_history
             WHERE (home_team = $1 OR away_team = $1)
               AND tt_home IS NOT NULL
             ORDER BY match_time DESC
             LIMIT $2`,
            [name, n],
          );
          if (rows.length === 0) return null;
          const perspective = toPerspectiveRows(rows, name);
          const tierInfo = tierByTeam.get(name) ?? null;
          const computed = computeTeamForm(perspective, tierInfo);
          const block: TeamFormBlock = {
            team: name,
            matches: perspective,
            ...computed,
          };
          return block;
        }),
      );
      for (const b of results) if (b) blocks.push(b);
    }

    if (teamFilter && blocks.length === 0) {
      return Response.json({ ok: false, error: `Team not found: ${teamFilter}` } satisfies GsTeamHistoryResponse);
    }

    return Response.json({ ok: true, n, teams: blocks } satisfies GsTeamHistoryResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsTeamHistoryResponse);
  }
}

// ── matchup implementation (2-team H2H) ──────────────────────────────────────

interface MatchupDbRow {
  match_time: string;
  league: string | null;
  home_team: string;
  away_team: string;
  h1_home: number; h1_away: number;
  tt_home: number; tt_away: number;
}

/** Flip each DB row team-oriented (Team A / Team B perspective, not home/away). */
function toMatchupRows(dbRows: MatchupDbRow[], teamA: string): MatchupRow[] {
  return dbRows.map((r) => {
    const isAHome = r.home_team === teamA;
    return {
      time: fmtTime(r.match_time),
      league: r.league ?? '',
      aH1: Number(isAHome ? r.h1_home : r.h1_away),
      bH1: Number(isAHome ? r.h1_away : r.h1_home),
      aFT: Number(isAHome ? r.tt_home : r.tt_away),
      bFT: Number(isAHome ? r.tt_away : r.tt_home),
    };
  });
}

async function handleMatchup(pool: Pool, teamA: string, teamB: string) {
  if (!teamA || !teamB)
    return Response.json({ ok: false, error: 'missing teamA/teamB' } satisfies MatchupResponse);
  if (teamA === teamB)
    return Response.json({ ok: false, error: 'teamA và teamB phải khác nhau' } satisfies MatchupResponse);

  try {
    const { rows: dbRows } = await pool.query<MatchupDbRow>(
      `SELECT match_time, league, home_team, away_team,
              h1_home, h1_away, tt_home, tt_away
       FROM gs_matches_history
       WHERE ( (home_team = $1 AND away_team = $2)
            OR (home_team = $2 AND away_team = $1) )
         AND tt_home IS NOT NULL
       ORDER BY match_time DESC`,
      [teamA, teamB],
    );

    const rows = toMatchupRows(dbRows, teamA);
    const matchup = computeMatchup(rows, teamA, teamB);

    return Response.json({ ok: true, matchup } satisfies MatchupResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies MatchupResponse);
  }
}
