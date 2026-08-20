// db.mjs — 2 query READ-ONLY (§3.1, §3.2). Không có INSERT/UPDATE/DELETE/
// CREATE/DROP/ALTER/TRUNCATE ở bất kỳ đâu trong tx-lab/rung/.
//
// Không import `loadAnalysisUrl` từ tx-lab/db.mjs: file đó không export hàm này
// và nó ép `ssl: { rejectUnauthorized: false }` (hợp Supabase mirror, nhưng
// ANALYSIS_DATABASE_URL hiện trỏ Postgres nội bộ không TLS — bê nguyên sẽ gãy).
// Nên chép 10 dòng parse env vào đây thay vì sửa file đang phục vụ bài GA khác.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

function loadAnalysisUrl() {
  if (process.env.ANALYSIS_DATABASE_URL) return process.env.ANALYSIS_DATABASE_URL;
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '..', '.env.local'); // repo root
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(`ANALYSIS_DATABASE_URL not set and ${envPath} not readable`);
  }
  const m = text.match(/^\s*ANALYSIS_DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error('ANALYSIS_DATABASE_URL missing in .env.local');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const TICKS_SQL = `
SELECT t.event_id, t.recorded_at, t.minute, t.period, t.is_h2,
       t.score_home, t.score_away, t.betting_open, t.match_suspended,
       t.ft_line, t.ft_tai, t.ft_xiu, t.ft_susp,
       t.h1_line, t.h1_tai, t.h1_xiu, t.h1_susp,
       t.match_type, t.league_id,
       t.raw -> 'ouLines'   AS ou_ft_raw,
       t.raw -> 'ouH1Lines' AS ou_h1_raw
FROM gs_16p_ticks t
WHERE t.league_id = $1
  AND t.period IN (2, 8)
ORDER BY t.event_id, t.recorded_at ASC, t.id ASC
`;

const HISTORY_SQL = `
SELECT event_id, league_id, match_time,
       h1_home, h1_away, tt_home, tt_away
FROM gs_matches_history
WHERE league_id = $1
`;

// Inventory chỉ để in bảng T1 (không dùng cho backtest).
const INVENTORY_SQL = `
SELECT league_id, match_type, is_h2,
       count(*)                       AS ticks,
       count(DISTINCT event_id)       AS events,
       min(minute)                    AS min_minute,
       max(minute)                    AS max_minute
FROM gs_16p_ticks
WHERE league_id = $1 AND period IN (2, 8)
GROUP BY 1, 2, 3
ORDER BY 3
`;

// Đối chiếu hợp đồng dữ liệu §1.3: cột phẳng có đúng là raw->…->0 không.
const LADDER_ASSERT_SQL = `
SELECT
  count(*) FILTER (WHERE jsonb_array_length(raw->'ouLines') > 0
                     AND ft_line IS NOT NULL)                              AS ft_have,
  count(*) FILTER (WHERE jsonb_array_length(raw->'ouLines') > 0
                     AND ft_line IS NOT NULL
                     AND abs(ft_line - (raw->'ouLines'->0->>'line')::numeric) < 1e-9) AS ft_match,
  count(*) FILTER (WHERE jsonb_array_length(raw->'ouH1Lines') > 0
                     AND h1_line IS NOT NULL)                              AS h1_have,
  count(*) FILTER (WHERE jsonb_array_length(raw->'ouH1Lines') > 0
                     AND h1_line IS NOT NULL
                     AND abs(h1_line - (raw->'ouH1Lines'->0->>'line')::numeric) < 1e-9) AS h1_match
FROM gs_16p_ticks
WHERE league_id = $1 AND period IN (2, 8)
`;

export async function fetchLeague(leagueId) {
  const pool = new Pool({ connectionString: loadAnalysisUrl(), max: 1 });
  try {
    const ticks = (await pool.query(TICKS_SQL, [leagueId])).rows;
    const history = (await pool.query(HISTORY_SQL, [leagueId])).rows;
    const inventory = (await pool.query(INVENTORY_SQL, [leagueId])).rows;
    const ladderAssert = (await pool.query(LADDER_ASSERT_SQL, [leagueId])).rows[0];
    return { ticks, history, inventory, ladderAssert };
  } finally {
    await pool.end();
  }
}
