import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set (graceful fallback like gs-bets)
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// Vietnamese/alternate → canonical English (same map as gs-team-analysis)
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

export interface GsTeamHistoryRow {
  time: string;          // "dd/mm/yyyy HH:MM" (GMT+7)
  opponent: string;      // opponent name "Xxx (V)"
  isHome: boolean;       // selected team was home?
  h1: [number, number];  // [selectedTeamH1, opponentH1]
  ft: [number, number];  // [selectedTeamFT, opponentFT]
}

export interface GsTeamHistoryResponse {
  ok: boolean;
  error?: string;
  team?: string;               // echo of the resolved query team
  matches?: GsTeamHistoryRow[];
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsTeamHistoryResponse);

  const team = req.nextUrl.searchParams.get('team') ?? '';
  if (!team) return Response.json({ ok: false, error: 'missing team' } satisfies GsTeamHistoryResponse);

  try {
    const teamId = await resolveTeamId(pool, team);
    if (!teamId)
      return Response.json({ ok: false, error: `Team not found: ${team}` } satisfies GsTeamHistoryResponse);

    const { rows } = await pool.query(
      `SELECT match_time, home_team_id, away_team_id,
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
      const ms = new Date(r.match_time).getTime() + 7 * 60 * 60 * 1000; // GMT+7
      const d = new Date(ms);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const min = String(d.getUTCMinutes()).padStart(2, '0');
      return {
        time: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
        opponent: (isHome ? r.away_team : r.home_team) as string,
        isHome,
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
