import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

// Cap unbounded reads. These endpoints previously SELECTed every snapshot row
// across every event, then the client grouped + aggregated the whole set.
// We now bound the number of DISTINCT events fetched (snapshots per event are
// naturally small), so the payload stays flat regardless of history growth.
const RECENT_EVENT_LIMIT = 60; // newest N events for the "recent" list
const H2H_EVENT_LIMIT = 100;   // newest N head-to-head events for a team pair

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  }
  return pool;
}

// ---------- Name normalisation (same map as collector + gs-live) ----------

const VN_TO_EN: Record<string, string> = {
  'Nhật Bản': 'Japan',
  'Hàn Quốc': 'Korea Republic',
  'Trung Quốc': 'China',
  'Thái Lan': 'Thailand',
  'Việt Nam': 'Vietnam',
  'Ả Rập Xê Út': 'Saudi Arabia',
  'Ả Rập Saudi': 'Saudi Arabia',
  'Úc': 'Australia',
  'Ấn Độ': 'India',
  'Campuchia': 'Cambodia',
  'Lào': 'Laos',
  'Nga': 'Russia',
  'Đức': 'Germany',
  'Pháp': 'France',
  'Tây Ban Nha': 'Spain',
  'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands',
  'Bỉ': 'Belgium',
  'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden',
  'Na Uy': 'Norway',
  'Áo': 'Austria',
  'Ý': 'Italy',
  'Anh': 'England',
  'Maroc': 'Morocco',
  'Mỹ': 'USA',
  'Viet Nam': 'Vietnam',
  'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic',
  'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea',
  'IR Iran': 'Iran',
  'Islamic Republic of Iran': 'Iran',
  'Brunei Darussalam': 'Brunei',
};

/** Parse "Korea Republic (V)" → { base: "Korea Republic", type: "V" } after normalising. */
function parseTeamName(name: string): { base: string; type: string } | null {
  const m = name.trim().match(/^(.+?)\s+\(([VS])\)$/);
  if (!m) return null;
  const raw = m[1].trim();
  return { base: VN_TO_EN[raw] ?? raw, type: m[2] };
}

/** Normalise any team name variant → ID in gs_teams. Returns null if team unknown. */
async function resolveTeamId(db: Pool, name: string): Promise<{ id: number; display: string } | null> {
  const parsed = parseTeamName(name);
  if (!parsed) return null;
  const { rows } = await db.query<{ id: number }>(
    'SELECT id FROM gs_teams WHERE name = $1 AND type = $2',
    [parsed.base, parsed.type],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, display: `${parsed.base} (${parsed.type})` };
}

// ---------- Types ----------

interface Snapshot {
  snapshotType: string;
  period: number | null;
  minute: number | null;
  isH2: boolean;
  scoreHome: number;
  scoreAway: number;
  suspended: boolean;
  bettingOpen: boolean;
  oddsHome: string | null;
  oddsAway: string | null;
  oddsDraw: string | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  hcLine: string | null;
  hcHomeOdds: string | null;
  hcAwayOdds: string | null;
  hcHomeGives: boolean;
  hcH1Line: string | null;
  hcH1HomeOdds: string | null;
  hcH1AwayOdds: string | null;
  hcH1HomeGives: boolean;
  ouLine: string | null;
  ouOver: string | null;
  ouUnder: string | null;
  ouH1Line: string | null;
  ouH1Over: string | null;
  ouH1Under: string | null;
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  cornersHome: number;
  cornersAway: number;
  recordedAt: string | null;
}

interface MatchGroup {
  eventId: number;
  matchDate: string | null;
  matchType: string | null;
  homeTeam: string;
  awayTeam: string;
  finalScore: { home: number; away: number };
  snapshots: Snapshot[];
}

type Row = Record<string, unknown>;

// ---------- Helpers ----------

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toSnapshot(r: Row): Snapshot {
  return {
    snapshotType: str(r.snapshot_type) ?? '',
    period: r.period == null ? null : num(r.period),
    minute: r.minute == null ? null : num(r.minute),
    isH2: r.is_h2 === true,
    scoreHome: num(r.score_home),
    scoreAway: num(r.score_away),
    suspended: r.suspended === true,
    bettingOpen: r.betting_open === true,
    oddsHome: str(r.odds_home),
    oddsAway: str(r.odds_away),
    oddsDraw: str(r.odds_draw),
    malayHome: str(r.malay_home),
    malayAway: str(r.malay_away),
    malayDraw: str(r.malay_draw),
    hcLine: str(r.hc_line),
    hcHomeOdds: str(r.hc_home_odds),
    hcAwayOdds: str(r.hc_away_odds),
    hcHomeGives: r.hc_home_gives === true,
    hcH1Line: str(r.hc_h1_line),
    hcH1HomeOdds: str(r.hc_h1_home_odds),
    hcH1AwayOdds: str(r.hc_h1_away_odds),
    hcH1HomeGives: r.hc_h1_home_gives === true,
    ouLine: str(r.ou_line),
    ouOver: str(r.ou_over),
    ouUnder: str(r.ou_under),
    ouH1Line: str(r.ou_h1_line),
    ouH1Over: str(r.ou_h1_over),
    ouH1Under: str(r.ou_h1_under),
    yellowHome: num(r.yellow_home),
    yellowAway: num(r.yellow_away),
    redHome: num(r.red_home),
    redAway: num(r.red_away),
    cornersHome: num(r.corners_home),
    cornersAway: num(r.corners_away),
    recordedAt:
      r.recorded_at instanceof Date
        ? (r.recorded_at as Date).toISOString()
        : str(r.recorded_at),
  };
}

function fmtDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v == null) return null;
  return String(v).slice(0, 10);
}

function groupRows(rows: Row[]): MatchGroup[] {
  const byEvent = new Map<number, MatchGroup>();
  for (const r of rows) {
    const eventId = num(r.event_id);
    let group = byEvent.get(eventId);
    if (!group) {
      group = {
        eventId,
        matchDate: fmtDate(r.match_date),
        matchType: str(r.match_type),
        homeTeam: String(r.home_team ?? ''),
        awayTeam: String(r.away_team ?? ''),
        finalScore: { home: 0, away: 0 },
        snapshots: [],
      };
      byEvent.set(eventId, group);
    }
    const snap = toSnapshot(r);
    group.snapshots.push(snap);
    group.finalScore = { home: snap.scoreHome, away: snap.scoreAway };
  }
  return [...byEvent.values()];
}

// JOIN query fragment: enriches rows with display names from gs_teams
const SELECT_WITH_NAMES = `
  SELECT mol.*,
         ht.name || ' (' || ht.type || ')' AS home_team,
         at.name || ' (' || at.type || ')' AS away_team
  FROM match_odds_log mol
  JOIN gs_teams ht ON ht.id = mol.home_team_id
  JOIN gs_teams at ON at.id = mol.away_team_id
`;

// ---------- Route ----------

export async function GET(req: NextRequest) {
  const action   = req.nextUrl.searchParams.get('action');
  const homeTeam = req.nextUrl.searchParams.get('homeTeam');
  const awayTeam = req.nextUrl.searchParams.get('awayTeam');

  try {
    const db = getPool();

    // List all known teams from gs_teams (single source of truth)
    if (action === 'teams') {
      const { rows } = await db.query<{ display: string }>(
        `SELECT name || ' (' || type || ')' AS display
         FROM gs_teams ORDER BY type, name`,
      );
      return NextResponse.json({ ok: true, teams: rows.map(r => r.display) });
    }

    // Newest N events only — bounded so the client never groups an unbounded set.
    if (action === 'recent') {
      const { rows } = await db.query<Row>(
        `${SELECT_WITH_NAMES}
         WHERE mol.event_id IN (
           SELECT event_id FROM match_odds_log
           GROUP BY event_id
           ORDER BY MAX(recorded_at) DESC
           LIMIT $1
         )
         ORDER BY mol.event_id, mol.recorded_at`,
        [RECENT_EVENT_LIMIT],
      );
      const matches = groupRows(rows).sort((a, b) => {
        const aT = a.snapshots.at(-1)?.recordedAt ?? '';
        const bT = b.snapshots.at(-1)?.recordedAt ?? '';
        return bT.localeCompare(aT);
      });
      return NextResponse.json({ ok: true, matches });
    }

    if (!homeTeam || !awayTeam) {
      return NextResponse.json(
        { ok: false, error: 'homeTeam and awayTeam are required' },
        { status: 400 },
      );
    }

    // Normalize → lookup ID (single source of truth: gs_teams)
    const [home, away] = await Promise.all([
      resolveTeamId(db, homeTeam),
      resolveTeamId(db, awayTeam),
    ]);

    if (!home || !away) {
      const missing = [!home && homeTeam, !away && awayTeam].filter(Boolean).join(', ');
      return NextResponse.json({ ok: false, error: `Team not found: ${missing}` }, { status: 404 });
    }

    // Single query, both directions, filter by ID — no string comparison.
    // Bounded to the newest N matching events so the payload can't grow unbounded.
    const { rows } = await db.query<Row>(
      `${SELECT_WITH_NAMES}
       WHERE mol.event_id IN (
         SELECT event_id FROM match_odds_log
         WHERE (home_team_id = $1 AND away_team_id = $2)
            OR (home_team_id = $2 AND away_team_id = $1)
         GROUP BY event_id
         ORDER BY MAX(recorded_at) DESC
         LIMIT $3
       )
       ORDER BY mol.event_id, mol.recorded_at`,
      [home.id, away.id, H2H_EVENT_LIMIT],
    );

    const allMatches = groupRows(rows);
    const aMatches = allMatches.filter(m => m.homeTeam === home.display);
    const bMatches = allMatches.filter(m => m.homeTeam === away.display);

    return NextResponse.json({ ok: true, aMatches, bMatches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ---------- Admin: upsert team alias (optional) ----------

export async function POST(req: NextRequest) {
  try {
    const { name, type } = (await req.json()) as { name?: string; type?: string };
    if (!name || !type || !['V', 'S'].includes(type)) {
      return NextResponse.json({ ok: false, error: 'name and type (V|S) required' }, { status: 400 });
    }
    const db = getPool();
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO gs_teams (name, type) VALUES ($1, $2)
       ON CONFLICT (name, type) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name.trim(), type],
    );
    return NextResponse.json({ ok: true, id: rows[0].id, name: name.trim(), type });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
