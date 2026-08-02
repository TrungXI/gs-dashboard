import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

export interface LeaguePrior {
  leagueTag: string; // '16p' | '20p' | '16p:S' | '16p:V' | '20p:S' | '20p:V'
  h1Bucket: number; // 0..7 (7 = "7+")
  market: 'ft' | 'h1';
  n: number;
  pTai: number; // Laplace-smoothed (A=1), giống pTaiEmpirical client
  avgTotal: number;
}

export interface LeaguePriorsResponse {
  ok: boolean;
  error?: string;
  priors?: LeaguePrior[];
  generatedAt?: string;
}

// In-module cache 10' (force-dynamic ⇒ không dùng revalidate được).
let _cache: { ts: number; data: LeaguePriorsResponse } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

// leagueTag = match_type + variant (:S/:V) suy từ gs_teams.type của HOME team,
// mirror client caller: `${matchType}${homeTeam.includes('(S)')?':S':homeTeam.includes('(V)')?':V':''}`.
// h1Bucket = LEAST(h1 total, 7). Line lấy từ match_odds_log pre-match snapshot
// (period=2, first_seen) qua join ±900s giống fetchH2HMatrix — gs_matches_history
// KHÔNG chứa cột line. Laplace A=1 để khớp pTaiEmpirical phía client.
const PRIORS_SQL = `
  WITH first_seen AS (
    SELECT event_id, home_team_id, away_team_id, MIN(recorded_at) AS fs_at
    FROM match_odds_log
    GROUP BY event_id, home_team_id, away_team_id
  ),
  ev AS (
    SELECT DISTINCT ON (mh.id)
      mh.id AS mh_id,
      mh.match_type,
      ht.type AS home_type,
      mh.h1_home, mh.h1_away, mh.tt_home, mh.tt_away,
      fs.event_id
    FROM gs_matches_history mh
    LEFT JOIN gs_teams ht ON ht.id = mh.home_team_id
    JOIN first_seen fs
      ON fs.home_team_id = mh.home_team_id
     AND fs.away_team_id = mh.away_team_id
     AND abs(extract(epoch FROM (fs.fs_at - mh.match_time))) <= 900
    ORDER BY mh.id, abs(extract(epoch FROM (fs.fs_at - mh.match_time)))
  ),
  pre AS (
    SELECT DISTINCT ON (event_id) event_id,
      COALESCE(NULLIF(ou_line,''),    ou_line_recovered)    AS ou_line,
      COALESCE(NULLIF(ou_h1_line,''), ou_h1_line_recovered) AS ou_h1_line
    FROM match_odds_log
    WHERE snapshot_type = 'first_seen' AND period = 2
    ORDER BY event_id, recorded_at
  ),
  graded AS (
    SELECT
      ev.match_type
        || CASE WHEN ev.home_type IN ('S','V') THEN ':' || ev.home_type ELSE '' END AS league_tag,
      LEAST(ev.h1_home + ev.h1_away, 7) AS h1_bucket,
      (ev.tt_home + ev.tt_away) AS ft_total,
      pre.ou_line::numeric  AS ft_line,
      (ev.h1_home + ev.h1_away) AS h1_total,
      pre.ou_h1_line::numeric AS h1_line
    FROM ev
    JOIN pre ON pre.event_id = ev.event_id
  )
  SELECT league_tag, h1_bucket, 'ft'::text AS market,
    COUNT(*) FILTER (WHERE ft_line IS NOT NULL AND ft_total > ft_line)::int AS over_c,
    COUNT(*) FILTER (WHERE ft_line IS NOT NULL AND ft_total < ft_line)::int AS under_c,
    COUNT(*) FILTER (WHERE ft_line IS NOT NULL)::int AS n,
    ROUND(AVG(ft_total) FILTER (WHERE ft_line IS NOT NULL)::numeric, 2)::float8 AS avg_total
  FROM graded
  WHERE league_tag IS NOT NULL
  GROUP BY league_tag, h1_bucket
  HAVING COUNT(*) FILTER (WHERE ft_line IS NOT NULL) > 0

  UNION ALL

  SELECT league_tag, h1_bucket, 'h1'::text AS market,
    COUNT(*) FILTER (WHERE h1_line IS NOT NULL AND h1_total > h1_line)::int AS over_c,
    COUNT(*) FILTER (WHERE h1_line IS NOT NULL AND h1_total < h1_line)::int AS under_c,
    COUNT(*) FILTER (WHERE h1_line IS NOT NULL)::int AS n,
    ROUND(AVG(h1_total) FILTER (WHERE h1_line IS NOT NULL)::numeric, 2)::float8 AS avg_total
  FROM graded
  WHERE league_tag IS NOT NULL
  GROUP BY league_tag, h1_bucket
  HAVING COUNT(*) FILTER (WHERE h1_line IS NOT NULL) > 0
`;

export async function GET() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
    return Response.json(_cache.data);
  }

  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies LeaguePriorsResponse);

  try {
    const res = await pool.query(PRIORS_SQL);
    const priors: LeaguePrior[] = res.rows.map((r) => {
      const over = Number(r.over_c ?? 0);
      const under = Number(r.under_c ?? 0);
      const n = Number(r.n ?? 0);
      // Laplace A=1, push (total==line) đã bị loại khỏi over & under → khớp pTaiEmpirical.
      const pTai = (over + 1) / (over + under + 2);
      return {
        leagueTag: r.league_tag as string,
        h1Bucket: Number(r.h1_bucket),
        market: r.market as 'ft' | 'h1',
        n,
        pTai,
        avgTotal: Number(r.avg_total ?? 0),
      };
    });

    const result: LeaguePriorsResponse = { ok: true, priors, generatedAt: new Date().toISOString() };
    _cache = { ts: Date.now(), data: result };
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies LeaguePriorsResponse);
  }
}
