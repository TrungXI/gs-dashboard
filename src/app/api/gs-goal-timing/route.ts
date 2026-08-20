import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/gs-goal-timing
// Tính % trận có bàn thắng theo từng khung 5 phút cho cả 3 giải:
//   16p (league_id 2140), 20p Asian (2125), 20p Intl (1485)
// Nguồn: gs_16p_ticks (score diff giữa tick liên tiếp = bàn thắng)
// Cache 2h in-memory — tính 1 lần, phục vụ nhiều request.

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL, max: 2 });
  return _pool;
}

export interface GoalTimingWindow {
  window: string;        // "1–5"
  half: 1 | 2;
  goals: number;
  matchesScored: number;
  totalMatches: number;
  pct: number;
}

export interface LeagueStat {
  leagueId: number;
  matchType: string;
  label: string;
  totalMatches: number;           // gs_matches_history
  ticksMatches: number;           // gs_16p_ticks distinct events
  oddslogMatches: number;         // match_odds_log distinct events
  avgGoals: number;
  avgH1: number;
  avgH2: number;
  pctGoalless: number;
  windows: GoalTimingWindow[];       // từ gs_16p_ticks
  windowsOddslog: GoalTimingWindow[]; // từ match_odds_log
}

export interface GoalTimingResponse {
  ok: boolean;
  leagues: LeagueStat[];
  cachedAt: string;
  error?: string;
}

// ── 2-hour cache ─────────────────────────────────────────────────────────────
const CACHE_TTL = 2 * 60 * 60 * 1000;
let _cache: { data: GoalTimingResponse; ts: number } | null = null;

const LEAGUES = [
  { id: 2140, matchType: '16p',       label: '16p (S)' },
  { id: 2125, matchType: '20p',       label: '20p Asian (V)' },
  { id: 1485, matchType: '20p_intl',  label: '20p Quốc Tế (QT)' },
  { id: 1508, matchType: '20p_club',  label: 'CLB (V)' },
] as const;

async function compute(): Promise<GoalTimingResponse> {
  const pool = getPool();

  // All league stats + window data in parallel
  const results = await Promise.all(
    LEAGUES.map(async (lg) => {
      const [statsRes, winRes, srcRes, winOddsRes] = await Promise.all([
        pool.query<{ matches: string; avg_total: string; avg_h1: string; avg_h2: string; goalless: string }>(`
          SELECT
            COUNT(*) AS matches,
            ROUND(AVG(tt_home + tt_away), 2)                                      AS avg_total,
            ROUND(AVG(h1_home + h1_away), 2)                                      AS avg_h1,
            ROUND(AVG((tt_home + tt_away) - (h1_home + h1_away)), 2)              AS avg_h2,
            SUM(CASE WHEN tt_home + tt_away = 0 THEN 1 ELSE 0 END)                AS goalless
          FROM gs_matches_history WHERE match_type = $1
        `, [lg.matchType]),

        pool.query<{ window_min: string; half: string; goals: string; matches_scored: string; total: string; pct: string }>(`
          WITH ticks_lag AS (
            SELECT
              event_id, minute, period, is_h2,
              score_home + score_away AS total,
              LAG(score_home + score_away)
                OVER (PARTITION BY event_id ORDER BY recorded_at) AS prev_total
            FROM gs_16p_ticks
            WHERE league_id = $1 AND period IN (2, 8)
          ),
          goals AS (
            SELECT
              event_id,
              CASE WHEN is_h2 THEN minute + 45 ELSE minute END AS gmin
            FROM ticks_lag
            WHERE total > prev_total AND prev_total IS NOT NULL AND minute <= 45
          ),
          total_ev AS (
            SELECT COUNT(DISTINCT event_id) AS n FROM gs_16p_ticks WHERE league_id = $1
          )
          SELECT
            FLOOR((gmin - 1) / 5) * 5 + 1 || '–' ||
              (FLOOR((gmin - 1) / 5) * 5 + 5)                    AS window_min,
            CASE WHEN gmin <= 45 THEN 1 ELSE 2 END                AS half,
            COUNT(*)                                               AS goals,
            COUNT(DISTINCT event_id)                               AS matches_scored,
            (SELECT n FROM total_ev)                               AS total,
            ROUND(100.0 * COUNT(DISTINCT event_id) /
              NULLIF((SELECT n FROM total_ev), 0), 1)              AS pct
          FROM goals
          WHERE gmin BETWEEN 1 AND 90
          GROUP BY FLOOR((gmin - 1) / 5), CASE WHEN gmin <= 45 THEN 1 ELSE 2 END
          ORDER BY FLOOR((gmin - 1) / 5)
        `, [lg.id]),

        pool.query<{ ticks_n: string; oddslog_n: string }>(`
          SELECT
            (SELECT COUNT(DISTINCT event_id) FROM gs_16p_ticks   WHERE league_id  = $1) AS ticks_n,
            (SELECT COUNT(DISTINCT event_id) FROM match_odds_log WHERE match_type = $2) AS oddslog_n
        `, [lg.id, lg.matchType]),

        // windows từ match_odds_log (score change detection) — dùng match_type vì league_id thường NULL
        pool.query<{ window_min: string; half: string; goals: string; matches_scored: string; total: string; pct: string }>(`
          WITH ticks_lag AS (
            SELECT
              event_id, minute, period, is_h2,
              score_home + score_away AS total,
              LAG(score_home + score_away)
                OVER (PARTITION BY event_id ORDER BY recorded_at) AS prev_total
            FROM match_odds_log
            WHERE match_type = $1 AND period IN (2, 8)
              AND score_home IS NOT NULL AND score_away IS NOT NULL
          ),
          goals AS (
            SELECT
              event_id,
              CASE WHEN is_h2 THEN minute + 45 ELSE minute END AS gmin
            FROM ticks_lag
            WHERE total > prev_total AND prev_total IS NOT NULL AND minute <= 45
          ),
          total_ev AS (
            SELECT COUNT(DISTINCT event_id) AS n FROM match_odds_log WHERE match_type = $1
          )
          SELECT
            FLOOR((gmin - 1) / 5) * 5 + 1 || '–' ||
              (FLOOR((gmin - 1) / 5) * 5 + 5)                    AS window_min,
            CASE WHEN gmin <= 45 THEN 1 ELSE 2 END                AS half,
            COUNT(*)                                               AS goals,
            COUNT(DISTINCT event_id)                               AS matches_scored,
            (SELECT n FROM total_ev)                               AS total,
            ROUND(100.0 * COUNT(DISTINCT event_id) /
              NULLIF((SELECT n FROM total_ev), 0), 1)              AS pct
          FROM goals
          WHERE gmin BETWEEN 1 AND 90
          GROUP BY FLOOR((gmin - 1) / 5), CASE WHEN gmin <= 45 THEN 1 ELSE 2 END
          ORDER BY FLOOR((gmin - 1) / 5)
        `, [lg.matchType]),
      ]);

      const mapWindows = (rows: typeof winRes.rows) => rows.map((r) => ({
        window: r.window_min,
        half: parseInt(r.half) as 1 | 2,
        goals: parseInt(r.goals),
        matchesScored: parseInt(r.matches_scored),
        totalMatches: parseInt(r.total),
        pct: parseFloat(r.pct),
      }));

      const s = statsRes.rows[0];
      const total = parseInt(s.matches);
      const stat: LeagueStat = {
        leagueId: lg.id,
        matchType: lg.matchType,
        label: lg.label,
        totalMatches: total,
        ticksMatches: parseInt(srcRes.rows[0]?.ticks_n ?? '0'),
        oddslogMatches: parseInt(srcRes.rows[0]?.oddslog_n ?? '0'),
        avgGoals: parseFloat(s.avg_total),
        avgH1: parseFloat(s.avg_h1),
        avgH2: parseFloat(s.avg_h2),
        pctGoalless: total > 0 ? parseFloat((100 * parseInt(s.goalless) / total).toFixed(1)) : 0,
        windows: mapWindows(winRes.rows),
        windowsOddslog: mapWindows(winOddsRes.rows),
      };
      return stat;
    })
  );

  const data: GoalTimingResponse = {
    ok: true,
    leagues: results,
    cachedAt: new Date().toISOString(),
  };
  _cache = { data, ts: Date.now() };
  return data;
}

async function getData(): Promise<GoalTimingResponse> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data;
  return compute();
}

export async function GET() {
  try {
    const data = await getData();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=7200, stale-while-revalidate=300' },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err } as GoalTimingResponse, { status: 500 });
  }
}
