import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecentIntlMatch = {
  matchTime: string;
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  ftHome: number;
  ftAway: number;
};

const DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;
let pool: Pool | null = null;
function db() {
  if (!DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  return pool;
}

// Latest completed International 20p matches only. This route intentionally uses
// the tagged history rows (match_type + numeric league_id), never team-name heuristics.
export async function GET() {
  const client = db();
  if (!client) return NextResponse.json({ ok: false, error: 'database unavailable' }, { status: 503 });
  try {
    const { rows } = await client.query<{
      match_time: string; home_team: string; away_team: string;
      h1_home: number; h1_away: number; tt_home: number; tt_away: number;
    }>(`
      SELECT match_time, home_team, away_team, h1_home, h1_away, tt_home, tt_away
      FROM gs_matches_history
      WHERE match_type = '20p_intl'
        AND league_id = 1485
        AND h1_home IS NOT NULL AND h1_away IS NOT NULL
        AND tt_home IS NOT NULL AND tt_away IS NOT NULL
      ORDER BY match_time DESC
      LIMIT 10
    `);
    const matches: RecentIntlMatch[] = rows.map((r) => ({
      matchTime: r.match_time,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      h1Home: Number(r.h1_home), h1Away: Number(r.h1_away),
      ftHome: Number(r.tt_home), ftAway: Number(r.tt_away),
    }));
    return NextResponse.json({ ok: true, matches }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
