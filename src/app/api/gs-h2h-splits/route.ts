import { NextRequest } from 'next/server';
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

// ── Types ───────────────────────────────────────────────────────────────────

/** W/D/L split (from Team A's perspective) for one half. */
export interface Splits {
  aWin: number; draw: number; bWin: number; // raw counts (sum === meetings)
  aWinPct: number; drawPct: number; bWinPct: number; // rounded integer %, sum ~100
}

export interface PairResult {
  teamA: string; // echoed back exactly as received (for client keying)
  teamB: string;
  meetings: number; // real n (0..100). 0 => no history; UI flags.
  h1: Splits;
  h2: Splits;
}

export interface GsH2HSplitsResponse {
  ok: boolean;
  error?: string;
  pairs?: PairResult[];
}

// ── In-memory cache (pairs repeat across rows, history changes slowly) ────────

const CACHE_TTL_MS = 600_000; // 10 min
const cache = new Map<string, { data: PairResult; ts: number }>();

function cacheKey(teamA: string, teamB: string): string {
  return `${teamA}|${teamB}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_PAIRS = 100;

const ALLOWED_LIMITS = new Set([20, 50, 100]);
const DEFAULT_LIMIT = 100;

/** ?limit=20|50|100 — số trận đối đầu gần nhất để tính %. Mặc định 100. */
function parseLimit(params: URLSearchParams): number {
  const raw = Number(params.get('limit'));
  return ALLOWED_LIMITS.has(raw) ? raw : DEFAULT_LIMIT;
}

/** ?both=1 — gộp cả 2 chiều đối đầu (A vs B + B vs A). Mặc định tắt (1 chiều). */
function parseBoth(params: URLSearchParams): boolean {
  return params.get('both') === '1';
}

function pct(count: number, meetings: number): number {
  return meetings > 0 ? Math.round((count / meetings) * 100) : 0;
}

function toSplits(aWin: number, draw: number, bWin: number, meetings: number): Splits {
  return {
    aWin, draw, bWin,
    aWinPct: pct(aWin, meetings),
    drawPct: pct(draw, meetings),
    bWinPct: pct(bWin, meetings),
  };
}

/** Parse the ?pairs=A|B,A2|B2 batch param + ?teamA=&teamB= single convenience into [A,B] tuples. */
function parsePairs(params: URLSearchParams): [string, string][] {
  const out: [string, string][] = [];

  const teamA = params.get('teamA');
  const teamB = params.get('teamB');
  if (teamA && teamB) out.push([teamA, teamB]);

  const raw = params.get('pairs');
  if (raw) {
    for (const item of raw.split(',')) {
      const idx = item.indexOf('|');
      if (idx < 0) continue;
      const a = item.slice(0, idx).trim();
      const b = item.slice(idx + 1).trim();
      if (a && b) out.push([a, b]);
    }
  }

  // Dedupe by A|B key, cap defensively.
  const seen = new Set<string>();
  const deduped: [string, string][] = [];
  for (const [a, b] of out) {
    const k = cacheKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push([a, b]);
    if (deduped.length >= MAX_PAIRS) break;
  }
  return deduped;
}

interface RawRow {
  team_a: string;
  team_b: string;
  meetings: string | number;
  h1_awin: string | number;
  h1_draw: string | number;
  h1_bwin: string | number;
  h2_awin: string | number;
  h2_draw: string | number;
  h2_bwin: string | number;
}

// One parameterized query over all requested pairs: UNNEST parallel arrays into a
// pair list, cap at last N by match_time, then aggregate W/D/L. LEFT JOIN so
// 0-meeting pairs return.
//   $4 = both-directions toggle:
//     false → keep ONLY the exact orientation (Team A home vs Team B away).
//     true  → also include the reverse fixtures (Team B home vs Team A away),
//             with scores normalized to Team A's perspective via CASE, so
//             "A vs B" and "B vs A" are merged into one head-to-head record.
//   "h1" bucket = HALFTIME result (h1_home vs h1_away).
//   "h2" bucket = FULL-TIME result (tt_home vs tt_away) — the FINAL score,
//                  NOT second-half-only goals. (draw = trận hoà chung cuộc.)
const SQL = `
WITH req AS (
  SELECT * FROM UNNEST($1::text[], $2::text[]) AS t(team_a, team_b)
),
oriented AS (
  SELECT
    r.team_a, r.team_b,
    CASE WHEN h.home_team = r.team_a THEN h.h1_home ELSE h.h1_away END AS a_h1,
    CASE WHEN h.home_team = r.team_a THEN h.h1_away ELSE h.h1_home END AS b_h1,
    CASE WHEN h.home_team = r.team_a THEN h.tt_home ELSE h.tt_away END AS a_ft,
    CASE WHEN h.home_team = r.team_a THEN h.tt_away ELSE h.tt_home END AS b_ft,
    ROW_NUMBER() OVER (
      PARTITION BY r.team_a, r.team_b
      ORDER BY h.match_time DESC
    ) AS rn
  FROM req r
  JOIN gs_matches_history h
    ON (h.home_team = r.team_a AND h.away_team = r.team_b)
    OR ($4::bool AND h.home_team = r.team_b AND h.away_team = r.team_a)
),
capped AS (
  SELECT * FROM oriented WHERE rn <= $3::int
)
SELECT
  r.team_a, r.team_b,
  COUNT(c.rn)                              AS meetings,
  COUNT(*) FILTER (WHERE c.a_h1 > c.b_h1)  AS h1_awin,
  COUNT(*) FILTER (WHERE c.a_h1 = c.b_h1)  AS h1_draw,
  COUNT(*) FILTER (WHERE c.a_h1 < c.b_h1)  AS h1_bwin,
  COUNT(*) FILTER (WHERE c.a_ft > c.b_ft)  AS h2_awin,
  COUNT(*) FILTER (WHERE c.a_ft = c.b_ft)  AS h2_draw,
  COUNT(*) FILTER (WHERE c.a_ft < c.b_ft)  AS h2_bwin
FROM req r
LEFT JOIN capped c ON c.team_a = r.team_a AND c.team_b = r.team_b
GROUP BY r.team_a, r.team_b;
`;

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsH2HSplitsResponse);

  const requested = parsePairs(req.nextUrl.searchParams);
  if (requested.length === 0) return Response.json({ ok: true, pairs: [] } satisfies GsH2HSplitsResponse);

  const limit = parseLimit(req.nextUrl.searchParams);
  const both = parseBoth(req.nextUrl.searchParams);
  const now = Date.now();

  // Split into fresh cache-hits vs misses; only query the misses. Cache is keyed
  // per (limit, both, pair) so switching 20/50/100 or the 2-chiều toggle doesn't collide.
  const ckey = (a: string, b: string) => `${limit}|${both ? 'B' : '1'}|${cacheKey(a, b)}`;
  const hits: PairResult[] = [];
  const misses: [string, string][] = [];
  for (const [a, b] of requested) {
    const entry = cache.get(ckey(a, b));
    if (entry && now - entry.ts < CACHE_TTL_MS) hits.push(entry.data);
    else misses.push([a, b]);
  }

  if (misses.length === 0) {
    return Response.json({ ok: true, pairs: hits } satisfies GsH2HSplitsResponse);
  }

  try {
    const teamAs = misses.map(([a]) => a);
    const teamBs = misses.map(([, b]) => b);
    const res = await pool.query<RawRow>(SQL, [teamAs, teamBs, limit, both]);

    const fetched: PairResult[] = res.rows.map((r) => {
      const meetings = Number(r.meetings);
      const result: PairResult = {
        teamA: r.team_a,
        teamB: r.team_b,
        meetings,
        h1: toSplits(Number(r.h1_awin), Number(r.h1_draw), Number(r.h1_bwin), meetings),
        h2: toSplits(Number(r.h2_awin), Number(r.h2_draw), Number(r.h2_bwin), meetings),
      };
      cache.set(ckey(r.team_a, r.team_b), { data: result, ts: now });
      return result;
    });

    return Response.json({ ok: true, pairs: [...hits, ...fetched] } satisfies GsH2HSplitsResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsH2HSplitsResponse);
  }
}
