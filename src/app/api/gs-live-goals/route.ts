import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Timeline ghi bàn cho các trận đang live. Ưu tiên gs_full_ticks vì logger này
// có cả International 20p (1485); chỉ fallback match_odds_log cho event chưa có tick.
let _pool: Pool | null = null;
function pool(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!_pool) _pool = new Pool({ connectionString: url, max: 2 });
  return _pool;
}

export async function GET(req: Request) {
  const ev = (new URL(req.url).searchParams.get('events') || '').split(',')
    .map((s) => parseInt(s, 10)).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ev.length) return Response.json({ ok: true, goals: [] });
  const db = pool();
  if (!db) return Response.json({ ok: false, error: 'no db' });

  try {
    const { rows } = await db.query(`
      WITH tick_events AS (
        SELECT DISTINCT event_id FROM gs_full_ticks
        WHERE event_id = ANY($1::int[]) AND recorded_at > now() - interval '4 hours'
      ), snapshots AS (
        SELECT t.event_id, t.minute, t.is_h2, t.score_home, t.score_away, t.recorded_at, t.id
        FROM gs_full_ticks t
        WHERE t.event_id = ANY($1::int[]) AND t.recorded_at > now() - interval '4 hours'
        UNION ALL
        SELECT l.event_id, l.minute, l.is_h2, l.score_home, l.score_away, l.recorded_at, l.id
        FROM match_odds_log l
        WHERE l.event_id = ANY($1::int[]) AND l.recorded_at > now() - interval '4 hours'
          AND NOT EXISTS (SELECT 1 FROM tick_events te WHERE te.event_id = l.event_id)
      ), r AS (
        SELECT event_id, minute, is_h2, score_home, score_away, recorded_at, id,
               lag(score_home) OVER w AS ph, lag(score_away) OVER w AS pa
        FROM snapshots
        WINDOW w AS (PARTITION BY event_id ORDER BY recorded_at, id)
      )
      SELECT event_id, minute, is_h2, score_home, score_away,
             (score_home > coalesce(ph, 0)) AS home_scored
      FROM r
      WHERE score_home > coalesce(ph, 0) OR score_away > coalesce(pa, 0)
      ORDER BY event_id, recorded_at, id`, [ev]);

    return Response.json({ ok: true, goals: rows.map((r) => ({
      e: Number(r.event_id), s: r.home_scored ? 'h' : 'a', h2: r.is_h2,
      m: Number(r.minute), sh: Number(r.score_home), sa: Number(r.score_away),
    })) });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
