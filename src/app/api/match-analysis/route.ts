import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  }
  return pool;
}

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

// ---------- Team alias table ----------
// Canonical team names are whatever match_odds_log stores (e.g. "Vietnam (V)").
// Aliases cover Vietnamese names, alternate English spellings, etc.
// The suffix "(V)" / "(S)" is preserved — only the base name is looked up.

const ALIAS_SEEDS: [string, string][] = [
  // Vietnamese base names → English canonical
  ['Nhật Bản', 'Japan'],
  ['Hàn Quốc', 'Korea Republic'],
  ['Trung Quốc', 'China'],
  ['Thái Lan', 'Thailand'],
  ['Việt Nam', 'Vietnam'],
  ['Ả Rập Xê Út', 'Saudi Arabia'],
  ['Ả Rập Saudi', 'Saudi Arabia'],
  ['Úc', 'Australia'],
  ['Ấn Độ', 'India'],
  ['Campuchia', 'Cambodia'],
  ['Lào', 'Laos'],
  ['Philippines', 'Philippines'],
  ['Malaysia', 'Malaysia'],
  ['Indonesia', 'Indonesia'],
  ['Singapore', 'Singapore'],
  ['Myanmar', 'Myanmar'],
  ['Iran', 'Iran'],
  ['Qatar', 'Qatar'],
  // English alternate spellings
  ['Viet Nam', 'Vietnam'],
  ['South Korea', 'Korea Republic'],
  ['Republic of Korea', 'Korea Republic'],
  ['DPR Korea', 'North Korea'],
  ['Korea DPR', 'North Korea'],
  ['IR Iran', 'Iran'],
  ['Islamic Republic of Iran', 'Iran'],
  ['New Zealand', 'New Zealand'],
  ['Saudi Arabia', 'Saudi Arabia'],
  ['Korea Republic', 'Korea Republic'],
  ['North Korea', 'North Korea'],
  ['Australia', 'Australia'],
  ['Japan', 'Japan'],
  ['China', 'China'],
  ['Thailand', 'Thailand'],
  ['Vietnam', 'Vietnam'],
  ['Brunei', 'Brunei'],
  ['Brunei Darussalam', 'Brunei'],
  ['Laos', 'Laos'],
  ['Cambodia', 'Cambodia'],
  ['India', 'India'],
  ['Indonesia', 'Indonesia'],
];

let aliasTableReady = false;

async function ensureAliasTable(db: Pool): Promise<void> {
  if (aliasTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS gs_team_aliases (
      alias     TEXT PRIMARY KEY,
      canonical TEXT NOT NULL
    )
  `);
  if (ALIAS_SEEDS.length > 0) {
    const placeholders = ALIAS_SEEDS.map((_, i) => `($${2 * i + 1}, $${2 * i + 2})`).join(', ');
    await db.query(
      `INSERT INTO gs_team_aliases (alias, canonical) VALUES ${placeholders}
       ON CONFLICT (alias) DO NOTHING`,
      ALIAS_SEEDS.flat(),
    );
  }
  aliasTableReady = true;
}

/** Resolve any team name variant to the canonical DB name.
 *  Input: "Viet Nam (V)" → Output: "Vietnam (V)"
 *  Strips suffix, looks up base alias, re-attaches suffix.
 */
async function resolveTeam(db: Pool, name: string): Promise<string> {
  const m = name.match(/^(.+?)(\s+\([VS]\))$/);
  if (!m) return name;
  const base = m[1].trim();
  const suffix = m[2];
  const { rows } = await db.query<{ canonical: string }>(
    'SELECT canonical FROM gs_team_aliases WHERE alias = $1',
    [base],
  );
  return (rows[0]?.canonical ?? base) + suffix;
}

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

function groupRows(rows: Row[], fallbackHome?: string, fallbackAway?: string): MatchGroup[] {
  const byEvent = new Map<number, MatchGroup>();
  for (const r of rows) {
    const eventId = num(r.event_id);
    let group = byEvent.get(eventId);
    if (!group) {
      group = {
        eventId,
        matchDate: fmtDate(r.match_date),
        matchType: str(r.match_type),
        homeTeam: String(r.home_team ?? fallbackHome ?? ''),
        awayTeam: String(r.away_team ?? fallbackAway ?? ''),
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

// ---------- Route ----------

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  const homeTeam = req.nextUrl.searchParams.get('homeTeam');
  const awayTeam = req.nextUrl.searchParams.get('awayTeam');

  try {
    const db = getPool();
    await ensureAliasTable(db);

    if (action === 'teams') {
      const { rows } = await db.query<{ team: string }>(
        `SELECT DISTINCT unnest(ARRAY[home_team, away_team]) as team
         FROM match_odds_log ORDER BY 1`,
      );
      const teams = rows.map((r) => r.team).filter(Boolean);
      return NextResponse.json({ ok: true, teams });
    }

    if (action === 'recent') {
      const { rows } = await db.query<Row>(
        `SELECT * FROM match_odds_log
         WHERE event_id IN (
           SELECT event_id FROM match_odds_log
           GROUP BY event_id
           ORDER BY MAX(recorded_at) DESC
           LIMIT 100
         )
         ORDER BY event_id, recorded_at`,
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

    // Normalize via alias table before querying
    const [resolvedHome, resolvedAway] = await Promise.all([
      resolveTeam(db, homeTeam),
      resolveTeam(db, awayTeam),
    ]);

    const { rows } = await db.query<Row>(
      `SELECT * FROM match_odds_log
       WHERE home_team = $1 AND away_team = $2
       ORDER BY event_id, recorded_at`,
      [resolvedHome, resolvedAway],
    );

    const matches = groupRows(rows, resolvedHome, resolvedAway);
    return NextResponse.json({ ok: true, matches, resolvedHome, resolvedAway });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ---------- Admin: upsert aliases ----------

export async function POST(req: NextRequest) {
  try {
    const { alias, canonical } = (await req.json()) as { alias?: string; canonical?: string };
    if (!alias || !canonical) {
      return NextResponse.json({ ok: false, error: 'alias and canonical required' }, { status: 400 });
    }
    const db = getPool();
    await ensureAliasTable(db);
    await db.query(
      `INSERT INTO gs_team_aliases (alias, canonical) VALUES ($1, $2)
       ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical`,
      [alias.trim(), canonical.trim()],
    );
    aliasTableReady = false; // force re-seed check next call
    return NextResponse.json({ ok: true, alias: alias.trim(), canonical: canonical.trim() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
