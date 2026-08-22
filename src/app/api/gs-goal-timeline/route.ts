import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import {
  buildGoalTimeline,
  METHODOLOGY_VERSION,
  DAYS_ALLOW,
  BIN_ALLOW,
  LEAGUE_ALLOW,
  BUFFER_MIN,
  type League,
  type OddsRawRow,
  type TickRawRow,
  type GoalTimelineResponse,
} from '../../../lib/goalTimeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/gs-goal-timeline?league=16p&days=14&bin=5
//   league : 16p | 20p_asian | 20p_intl
//   days   : 7 | 14
//   bin    : 5 | 10
// → GoalTimelineResponse (§6). Read-only DB (SELECT), in-memory cache TTL 60s.

// Reuse the shared analysis pool from gsMatchesDb (same ANALYSIS_DATABASE_URL).
// gsMatchesDb's getPool is not exported, so we build a local singleton against the
// same connection string — pg pools are per-process cheap and this route is one of
// a handful of read-only endpoints.
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL, max: 4 });
  return _pool;
}

// ── param clamp (§5) ────────────────────────────────────────────────────────
function clampLeague(v: string | null): { value: League; note?: string } {
  if (v && (LEAGUE_ALLOW as readonly string[]).includes(v)) return { value: v as League };
  return { value: '16p', note: `league '${v ?? ''}' invalid → default 16p` };
}
function clampNum(v: string | null, allow: readonly number[], fallback: number, name: string): { value: number; note?: string } {
  const n = Number(v);
  if (Number.isFinite(n) && allow.includes(n)) return { value: n };
  return { value: fallback, note: `${name} '${v ?? ''}' invalid → default ${fallback}` };
}

// ── in-memory cache TTL 60s (§5) ────────────────────────────────────────────
interface CacheEntry {
  at: number;
  payload: GoalTimelineResponse & { notes?: string[] };
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

// ── DB queries (§2) ─────────────────────────────────────────────────────────

// 16p / 20p_asian → match_odds_log. Pull EVERY row of every cohort event whose
// opening snapshot (MIN(recorded_at)) fell inside [now()-days, now()-BUFFER_MIN].
async function queryOdds(
  db: Pool,
  matchType: '16p' | '20p',
  days: number,
  excludeIntlTicks: boolean,
): Promise<{ rows: OddsRawRow[]; coverageStart: string | null; coverageEnd: string | null }> {
  // A cohort event = an event of this match_type whose FIRST recorded_at (any row)
  // is within the completed window. 20p_asian additionally excludes events that have
  // any tick in gs_full_ticks league_id=1485 (intl) or 1508 (club).
  const notExists = excludeIntlTicks
    ? `AND NOT EXISTS (SELECT 1 FROM gs_full_ticks t WHERE t.event_id = mol.event_id AND t.league_id IN (1485, 1508))`
    : '';

  const sql = `
    WITH cohort AS (
      SELECT event_id, MIN(recorded_at) AS start_at
      FROM match_odds_log mol
      WHERE mol.match_type = $1
        AND mol.recorded_at >= now() - ($2 || ' days')::interval
      ${notExists}
      GROUP BY event_id
      HAVING MIN(recorded_at) >= now() - ($2 || ' days')::interval
         AND MIN(recorded_at) <= now() - ($3 || ' minutes')::interval
    )
    SELECT mol.event_id, mol.snapshot_type, mol.period, mol.minute, mol.is_h2,
           mol.score_home, mol.score_away, mol.recorded_at
    FROM match_odds_log mol
    JOIN cohort c ON c.event_id = mol.event_id
    ORDER BY mol.event_id, mol.recorded_at, mol.id
  `;
  const { rows } = await db.query(sql, [matchType, String(days), String(BUFFER_MIN)]);

  const covSql = `
    SELECT MIN(recorded_at) AS cov_start, MAX(recorded_at) AS cov_end
    FROM match_odds_log
    WHERE match_type = $1 AND recorded_at >= now() - ($2 || ' days')::interval
  `;
  const cov = await db.query(covSql, [matchType, String(days)]);

  return {
    rows: rows as OddsRawRow[],
    coverageStart: cov.rows[0]?.cov_start ? new Date(cov.rows[0].cov_start).toISOString() : null,
    coverageEnd: cov.rows[0]?.cov_end ? new Date(cov.rows[0].cov_end).toISOString() : null,
  };
}

// 20p_intl → gs_full_ticks league_id=1485; 20p_club → league_id=1508.
async function queryTicks(
  db: Pool,
  days: number,
  leagueId: number,
): Promise<{ rows: TickRawRow[]; coverageStart: string | null; coverageEnd: string | null }> {
  const sql = `
    WITH cohort AS (
      SELECT event_id, MIN(recorded_at) AS start_at
      FROM gs_full_ticks
      WHERE league_id = $3
        AND recorded_at >= now() - ($1 || ' days')::interval
      GROUP BY event_id
      HAVING MIN(recorded_at) >= now() - ($1 || ' days')::interval
         AND MIN(recorded_at) <= now() - ($2 || ' minutes')::interval
    )
    SELECT t.event_id, t.period, t.minute, t.is_h2,
           t.score_home, t.score_away, t.recorded_at
    FROM gs_full_ticks t
    JOIN cohort c ON c.event_id = t.event_id
    WHERE t.league_id = $3
    ORDER BY t.event_id, t.recorded_at, t.id
  `;
  const { rows } = await db.query(sql, [String(days), String(BUFFER_MIN), leagueId]);

  const covSql = `
    SELECT MIN(recorded_at) AS cov_start, MAX(recorded_at) AS cov_end
    FROM gs_full_ticks
    WHERE league_id = $2 AND recorded_at >= now() - ($1 || ' days')::interval
  `;
  const cov = await db.query(covSql, [String(days), leagueId]);

  return {
    rows: rows as TickRawRow[],
    coverageStart: cov.rows[0]?.cov_start ? new Date(cov.rows[0].cov_start).toISOString() : null,
    coverageEnd: cov.rows[0]?.cov_end ? new Date(cov.rows[0].cov_end).toISOString() : null,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const leagueC = clampLeague(searchParams.get('league'));
    const daysC = clampNum(searchParams.get('days'), DAYS_ALLOW, 14, 'days');
    const binC = clampNum(searchParams.get('bin'), BIN_ALLOW, 5, 'bin');
    const notes = [leagueC.note, daysC.note, binC.note].filter(Boolean) as string[];

    const league = leagueC.value;
    const days = daysC.value;
    const bin = binC.value;

    const cacheKey = `${league}|${days}|${bin}|${METHODOLOGY_VERSION}`;
    const now = Date.now();
    const hit = cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({ ...hit.payload, cached: true, ...(notes.length ? { notes } : {}) });
    }

    const db = getPool();

    const completeThroughIso = new Date(now - BUFFER_MIN * 60_000).toISOString();
    let payload: GoalTimelineResponse;

    if (league === '20p_intl' || league === '20p_club') {
      const leagueId = league === '20p_club' ? 1508 : 1485;
      const { rows, coverageStart, coverageEnd } = await queryTicks(db, days, leagueId);
      payload = buildGoalTimeline(
        { tickRows: rows, sourceCoverageStart: coverageStart, sourceCoverageEnd: coverageEnd, completeThrough: completeThroughIso },
        { league, days, bin },
      );
    } else {
      const matchType: '16p' | '20p' = league === '16p' ? '16p' : '20p';
      const excludeIntl = league === '20p_asian';
      const { rows, coverageStart, coverageEnd } = await queryOdds(db, matchType, days, excludeIntl);
      payload = buildGoalTimeline(
        { oddsRows: rows, sourceCoverageStart: coverageStart, sourceCoverageEnd: coverageEnd, completeThrough: completeThroughIso },
        { league, days, bin },
      );
    }

    cache.set(cacheKey, { at: now, payload });
    return NextResponse.json({ ...payload, cached: false, ...(notes.length ? { notes } : {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
