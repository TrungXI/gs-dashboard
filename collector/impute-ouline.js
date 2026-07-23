'use strict'

// Impute opening ou_line/ou_h1_line null cho các event feed virtual thiếu line mở.
// 2 tầng: (A) real self-heal — line thật ở dòng first_seen/period=2 muộn hơn cùng event;
//         (B) h2h_impute — mode line theo cặp KHÔNG phân biệt sân + match_type.
// Chỉ ghi vào 3 cột recovered (nullable), KHÔNG đụng cột gốc. Idempotent: mode tính từ
// dòng gốc, chỉ lấp dòng first_seen/period=2 sớm nhất còn null → chạy N lần cùng kết quả.

require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const IMPUTE_SQL = `
WITH opening AS (
  SELECT DISTINCT ON (event_id)
         id AS row_id, event_id, match_type, home_team_id, away_team_id,
         NULLIF(ou_line,'')    AS ou_line,
         NULLIF(ou_h1_line,'') AS ou_h1_line
  FROM match_odds_log
  WHERE snapshot_type = 'first_seen' AND period = 2
  ORDER BY event_id, recorded_at ASC
),
good AS (
  SELECT match_type,
         LEAST(home_team_id, away_team_id)    AS a,
         GREATEST(home_team_id, away_team_id) AS b,
         NULLIF(ou_line,'')::numeric    AS ft_line,
         NULLIF(ou_h1_line,'')::numeric AS h1_line
  FROM opening
),
selfheal AS (
  SELECT o.event_id,
         (SELECT NULLIF(m.ou_line,'') FROM match_odds_log m
          WHERE m.event_id = o.event_id AND m.snapshot_type='first_seen' AND m.period=2
            AND NULLIF(m.ou_line,'') IS NOT NULL
          ORDER BY m.recorded_at ASC LIMIT 1)    AS ft_real,
         (SELECT NULLIF(m.ou_h1_line,'') FROM match_odds_log m
          WHERE m.event_id = o.event_id AND m.snapshot_type='first_seen' AND m.period=2
            AND NULLIF(m.ou_h1_line,'') IS NOT NULL
          ORDER BY m.recorded_at ASC LIMIT 1)    AS h1_real
  FROM opening o
),
impute AS (
  SELECT o.event_id, o.row_id,
         mode() WITHIN GROUP (ORDER BY g.ft_line)
                FILTER (WHERE g.ft_line IS NOT NULL)::text AS ft_mode,
         mode() WITHIN GROUP (ORDER BY g.h1_line)
                FILTER (WHERE g.h1_line IS NOT NULL)::text AS h1_mode
  FROM opening o
  JOIN good g
    ON g.match_type = o.match_type
   AND g.a = LEAST(o.home_team_id, o.away_team_id)
   AND g.b = GREATEST(o.home_team_id, o.away_team_id)
  GROUP BY o.event_id, o.row_id
),
resolved AS (
  SELECT o.row_id, o.event_id,
         CASE WHEN o.ou_line IS NULL
              THEN COALESCE(sh.ft_real, im.ft_mode) END AS ft_rec,
         CASE WHEN o.ou_h1_line IS NULL
              THEN COALESCE(sh.h1_real, im.h1_mode) END AS h1_rec,
         CASE
           WHEN o.ou_line IS NULL OR o.ou_h1_line IS NULL THEN
             CASE WHEN (o.ou_line    IS NULL AND sh.ft_real IS NULL AND im.ft_mode IS NOT NULL)
                    OR (o.ou_h1_line IS NULL AND sh.h1_real IS NULL AND im.h1_mode IS NOT NULL)
                  THEN 'h2h_impute' ELSE 'real_selfheal' END
           ELSE NULL
         END AS src
  FROM opening o
  LEFT JOIN selfheal sh ON sh.event_id = o.event_id
  LEFT JOIN impute   im ON im.event_id = o.event_id
  WHERE o.ou_line IS NULL OR o.ou_h1_line IS NULL
)
UPDATE match_odds_log t
SET ou_line_recovered    = r.ft_rec,
    ou_h1_line_recovered = r.h1_rec,
    ou_line_source       = r.src
FROM resolved r
WHERE t.id = r.row_id
  AND (r.ft_rec IS NOT NULL OR r.h1_rec IS NOT NULL);
`

async function main() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query(IMPUTE_SQL)
    await client.query('COMMIT')
    console.log(`[impute-ouline] ${new Date().toISOString()} updated ${res.rowCount} rows`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`[impute-ouline] ERROR: ${e.message}`)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
