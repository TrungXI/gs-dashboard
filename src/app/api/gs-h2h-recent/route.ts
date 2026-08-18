import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;
let pool: Pool | null = null;
function db() {
  if (!DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  return pool;
}

// Returns only completed meetings of the exact pair, irrespective of which team
// was home. This deliberately reads gs_matches_history: International 20p is
// not written to match_odds_log, so its eventId cannot be used by gs-h2h-pair.
export async function GET(req: NextRequest) {
  const homeTeam = req.nextUrl.searchParams.get('homeTeam')?.trim();
  const awayTeam = req.nextUrl.searchParams.get('awayTeam')?.trim();
  const matchType = req.nextUrl.searchParams.get('matchType');
  if (!homeTeam || !awayTeam || !matchType || !['20p_intl', '20p_club'].includes(matchType)) {
    return NextResponse.json({ ok: false, error: 'invalid pair' }, { status: 400 });
  }
  const client = db();
  if (!client) return NextResponse.json({ ok: false, error: 'database unavailable' }, { status: 503 });
  try {
    const { rows } = await client.query<{
      match_time: string; home_team: string; away_team: string;
      h1_home: number; h1_away: number; tt_home: number; tt_away: number;
    }>(`
      SELECT match_time, home_team, away_team, h1_home, h1_away, tt_home, tt_away
      FROM gs_matches_history
      WHERE match_type = $3
        AND ((home_team = $1 AND away_team = $2) OR (home_team = $2 AND away_team = $1))
        AND h1_home IS NOT NULL AND h1_away IS NOT NULL
        AND tt_home IS NOT NULL AND tt_away IS NOT NULL
      ORDER BY match_time DESC
      LIMIT 10
    `, [homeTeam, awayTeam, matchType]);
    return NextResponse.json({
      ok: true,
      // Keep the same shape consumed by H2HMiniList. International has no
      // opening-line records, so only the per-match H1/FT scores are shown.
      ft: null, h1: null, h1Totals: [], ftTotals: [],
      matches: rows.map((r) => ({
        date: r.match_time,
        home: r.home_team,
        away: r.away_team,
        htScore: `${Number(r.h1_home)}-${Number(r.h1_away)}`,
        ftScore: `${Number(r.tt_home)}-${Number(r.tt_away)}`,
        ft: { total: Number(r.tt_home) + Number(r.tt_away), line: null, result: null },
        h1: { total: Number(r.h1_home) + Number(r.h1_away), line: null, result: null },
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
