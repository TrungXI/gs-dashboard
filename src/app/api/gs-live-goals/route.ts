import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phút ghi bàn của các trận ĐANG LIVE — suy từ match_odds_log: mỗi lần score_home/score_away
// tăng so với snapshot liền trước (theo id) = 1 bàn, lấy minute + is_h2 tại dòng đó.
// Client truyền ?events=id1,id2,... (eventId các trận live) → trả phút + hiệp từng bàn.

let _pool: Pool | null = null;
function pool(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!_pool) _pool = new Pool({ connectionString: url, max: 2 });
  return _pool;
}

const strip = (s: string) => s.replace(/ \(V\)$/, '');

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const ev = (sp.get('events') || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
  if (ev.length === 0) return Response.json({ ok: true, goals: [] });
  const db = pool();
  if (!db) return Response.json({ ok: false, error: 'no db' });

  try {
    const { rows } = await db.query(`
      WITH r AS (
        SELECT l.event_id, l.match_type, l.home_team, l.away_team, l.minute, l.is_h2,
               l.score_home, l.score_away, l.id,
               lag(l.score_home) OVER w AS ph, lag(l.score_away) OVER w AS pa
        FROM match_odds_log l
        WHERE l.event_id = ANY($1::int[]) AND l.recorded_at > now() - interval '4 hours'
        WINDOW w AS (PARTITION BY l.event_id ORDER BY l.id)
      )
      SELECT event_id, match_type, home_team, away_team, minute, is_h2, score_home, score_away,
             (score_home > coalesce(ph, 0)) AS home_scored
      FROM r
      WHERE score_home > coalesce(ph, 0) OR score_away > coalesce(pa, 0)
      ORDER BY event_id, id`, [ev]);

    const goals = (rows as {
      event_id: number; match_type: string; home_team: string; away_team: string;
      minute: number; is_h2: boolean; score_home: number; score_away: number; home_scored: boolean;
    }[]).map((r) => ({
      eventId: r.event_id,
      matchType: r.match_type,
      home: strip(r.home_team),
      away: strip(r.away_team),
      team: r.home_scored ? strip(r.home_team) : strip(r.away_team),
      side: r.home_scored ? 'home' : 'away',
      half: r.is_h2 ? 'H2' : 'H1',
      minute: r.minute,
      sh: r.score_home,
      sa: r.score_away,
    }));
    return Response.json({ ok: true, goals });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
