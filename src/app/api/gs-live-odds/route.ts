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

export async function GET(req: Request) {
  const eventId = Number(new URL(req.url).searchParams.get('eventId'));
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    return Response.json({ ok: false, error: 'eventId không hợp lệ' }, { status: 400 });
  }
  const pool = db();
  if (!pool) return Response.json({ ok: false, error: 'no db' });
  try {
    const { rows } = await pool.query(`
      SELECT recorded_at, minute, period, is_h2, score_home, score_away,
             home_team, away_team,
             betting_open, match_suspended,
             ft_line, ft_tai, ft_xiu, ft_susp,
             h1_line, h1_tai, h1_xiu, h1_susp
      FROM gs_full_ticks
      WHERE event_id=$1
      ORDER BY recorded_at ASC
      LIMIT 1200`, [eventId]);
    // `numeric` columns are returned by pg as strings.  The chart deliberately
    // receives numbers so it cannot silently drop every odds point.
    const numeric = new Set(['minute', 'score_home', 'score_away', 'ft_line', 'ft_tai', 'ft_xiu', 'h1_line', 'h1_tai', 'h1_xiu']);
    const ticks = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key,
      numeric.has(key) && value != null ? Number(value) : value,
    ])));
    return Response.json({ ok: true, ticks });
  } catch (error) {
    return Response.json({ ok: false, error: String(error) });
  }
}
