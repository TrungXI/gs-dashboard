import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let singleton: Pool | null = null;
function db(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!singleton) singleton = new Pool({ connectionString: url, max: 2 });
  return singleton;
}

export interface SabaVideoMatch {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  streamingId: string | null;
  streamingSrc: number | null;
  score_home: number;
  score_away: number;
  minute: number | null;
}

export async function GET() {
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  try {
    const { rows } = await pool.query(`
      SELECT m.match_id, m.home_team, m.away_team, m.league_name,
             m.streaming_id, m.streaming_src, m.score_home, m.score_away, m.minute,
             hm.canonical_name AS home_canon, hm.mapped AS home_mapped,
             am.canonical_name AS away_canon, am.mapped AS away_mapped
      FROM saba_matches m
      LEFT JOIN saba_team_map hm ON hm.saba_name = m.home_team
      LEFT JOIN saba_team_map am ON am.saba_name = m.away_team
      WHERE m.is_live = true AND m.has_streaming = true
      ORDER BY m.league_group_id NULLS LAST, m.league_name NULLS LAST, m.match_id
    `);

    const matches: SabaVideoMatch[] = rows.map((m) => ({
      matchId: Number(m.match_id),
      homeTeam: (m.home_mapped === true && m.home_canon) ? m.home_canon : m.home_team,
      awayTeam: (m.away_mapped === true && m.away_canon) ? m.away_canon : m.away_team,
      leagueName: m.league_name ?? 'C-Sport',
      streamingId: m.streaming_id ?? null,
      streamingSrc: m.streaming_src != null ? Number(m.streaming_src) : null,
      score_home: Number(m.score_home ?? 0),
      score_away: Number(m.score_away ?? 0),
      minute: m.minute != null ? Number(m.minute) : null,
    }));

    return Response.json({ ok: true, matches });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }
}
