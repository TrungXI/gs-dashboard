import { Pool } from 'pg';
import type { Match } from '../types/match';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  }
  return pool;
}

export async function fetchAllMatches(): Promise<Match[]> {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT match_time, match_type, league, home_team, away_team,
           h1_home, h1_away, tt_home, tt_away
    FROM gs_matches_history
    ORDER BY match_time DESC
  `);

  return rows.map((r) => {
    const ms = new Date(r.match_time).getTime() + 7 * 60 * 60 * 1000;
    const d = new Date(ms);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return {
      date: `${dd}/${mm}/${yyyy}`,
      time: `${dd}/${mm}/${yyyy} ${hh}:${min}`,
      matchType: r.match_type as '20p' | '16p',
      league: r.league as string,
      homeTeam: r.home_team as string,
      awayTeam: r.away_team as string,
      h1Home: String(r.h1_home),
      h1Away: String(r.h1_away),
      ttHome: String(r.tt_home),
      ttAway: String(r.tt_away),
    };
  });
}
