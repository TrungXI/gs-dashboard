// db.mjs — the single, read-only DB read. Connect, run ONE query, close.
//
// NO writes ever happen here (no INSERT/UPDATE/DELETE/CREATE/DROP/ALTER). The
// harness treats match_odds_log as immutable history. Reviewer greps tx-lab/
// for write verbs — this file must stay clean.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

// Manual .env.local parse (repo has no `dotenv` dependency; SPEC §4.1 says do
// the 5-line parse rather than adding a package). Only reads ANALYSIS_DATABASE_URL.
function loadAnalysisUrl() {
  if (process.env.ANALYSIS_DATABASE_URL) return process.env.ANALYSIS_DATABASE_URL;
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = join(here, '..', '.env.local'); // repo root
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(
      `ANALYSIS_DATABASE_URL not set and ${envPath} not readable`,
    );
  }
  const m = text.match(/^\s*ANALYSIS_DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) throw new Error('ANALYSIS_DATABASE_URL missing in .env.local');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const QUERY = `
SELECT event_id, match_type, home_team, away_team, home_team_id, away_team_id,
       match_date, snapshot_type, minute, is_h2,
       score_home, score_away, suspended, betting_open,
       ou_line, ou_over, ou_under, ou_line_recovered, ou_line_source,
       yellow_home, yellow_away, red_home, red_away,
       corners_home, corners_away, recorded_at
FROM match_odds_log
ORDER BY event_id, recorded_at ASC
`;

// Fetch every row once, then close the pool. Returns an array of raw rows.
export async function fetchAllRows() {
  const connectionString = loadAnalysisUrl();
  const pool = new Pool({
    connectionString,
    // Remote managed Postgres requires TLS; cert chain is not pinned here.
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const res = await pool.query(QUERY);
    return res.rows;
  } finally {
    await pool.end();
  }
}
