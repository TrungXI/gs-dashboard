import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Backtest FT-XỈU per-CẶP: loop gs_matches_history (tổng bàn THẬT) × line MỞ 0-0 (match_odds_log,
// neo team + recorded_at±25'). Chấm Malay + line lẻ → ROI/winrate + line mở trung bình mỗi cặp.
// Nặng (~9s) → cache in-memory 10 phút.

const MIN_N = 15;
const MIN_ROI = 3; // %

const ALLOWED_DAYS = new Set(['1', '3', '7', '14', '21']); // 'all' = không giới hạn
// Cache LƯU DB (bảng gs_ft_backtest_cache) — job đêm precompute ghi sẵn, API chỉ đọc (nhanh, hết 9s/call).

let _pool: Pool | null = null;
function pool(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!_pool) _pool = new Pool({ connectionString: url, max: 2 });
  return _pool;
}

// Chấm 1 kèo: line L, tổng bàn ft, odds Malay o, over=true (TÀI/Over) / false (XỈU/Under) → pnl (cược 1 đơn vị).
function grade(L: number, ft: number, o: number, over: boolean): number {
  const wamt = o >= 0 ? o : 1;
  const lamt = o >= 0 ? -1 : o;
  const fl = Math.floor(L);
  const frac = Math.round((L - fl) * 100) / 100;
  if (!over) {
    // XỈU (Under): thắng khi ft < L
    if (frac === 0) return ft < L ? wamt : ft > L ? lamt : 0;
    if (frac === 0.5) return ft < L ? wamt : lamt;
    if (frac === 0.25) return ft < fl ? wamt : ft === fl ? wamt / 2 : lamt;
    return ft <= fl ? wamt : ft === fl + 1 ? lamt / 2 : lamt;
  }
  // TÀI (Over): thắng khi ft > L (mirror ngược)
  if (frac === 0) return ft > L ? wamt : ft < L ? lamt : 0;
  if (frac === 0.5) return ft > L ? wamt : lamt;
  if (frac === 0.25) return ft >= fl + 1 ? wamt : ft === fl ? lamt / 2 : lamt;
  return ft >= fl + 2 ? wamt : ft === fl + 1 ? wamt / 2 : lamt;
}

export async function GET(req: Request) {
  // ?days=1|3|7|14|21 → chỉ trận N ngày gần nhất; else 'all' = hết data. Mỗi mốc ra WL/BL khác nhau.
  const sp = new URL(req.url).searchParams;
  const raw = sp.get('days') || 'all';
  const days = ALLOWED_DAYS.has(raw) ? raw : 'all';
  const force = sp.get('force') === '1'; // cron đêm gọi force=1 để tính lại
  const db = pool();
  if (!db) return Response.json({ ok: false, error: 'no db' });

  // Đọc cache DB (job đêm ghi sẵn) → trả ngay, KHÔNG tính 9s. force=1 (cron) mới tính lại.
  if (!force) {
    try {
      const c = await db.query('SELECT data FROM gs_ft_backtest_cache WHERE days=$1', [days]);
      if (c.rows[0]?.data) return Response.json(c.rows[0].data);
    } catch { /* bảng chưa tạo → tính on-demand + tạo bên dưới */ }
  }

  // Lọc theo số ngày gần nhất (match_time). 'all' → không lọc.
  const dayFilter = days === 'all' ? '' : `AND mh.match_time >= now() - interval '${Number(days)} days'`;

  try {
    const { rows } = await db.query(`
      SELECT least(ht.name, at.name) || '|' || greatest(ht.name, at.name) AS pair,
             (mh.tt_home + mh.tt_away)::int AS ft, o.line::float AS line, o.over, o.under
      FROM gs_matches_history mh
      JOIN gs_teams ht ON ht.id = mh.home_team_id
      JOIN gs_teams at ON at.id = mh.away_team_id
      LEFT JOIN LATERAL (
        SELECT ol.ou_line::numeric AS line, ol.ou_over AS over, ol.ou_under AS under
        FROM match_odds_log ol
        WHERE ol.match_type = mh.match_type AND ol.score_home = 0 AND ol.score_away = 0
          AND ol.ou_line ~ '^[0-9.]+$'
          AND ( (replace(ol.home_team,' (V)','') = ht.name AND replace(ol.away_team,' (V)','') = at.name)
             OR (replace(ol.home_team,' (V)','') = at.name AND replace(ol.away_team,' (V)','') = ht.name) )
          AND ol.recorded_at BETWEEN mh.match_time - interval '25 min' AND mh.match_time + interval '25 min'
        ORDER BY ol.recorded_at, ol.id LIMIT 1
      ) o ON true
      WHERE ht.type = 'V' AND at.type = 'V' AND mh.match_type = '20p' ${dayFilter}
        AND mh.tt_home IS NOT NULL AND o.line IS NOT NULL`);

    type Agg = { n: number; xPnl: number; xW: number; xL: number; tPnl: number; tW: number; tL: number; lineSum: number };
    const agg = new Map<string, Agg>();
    for (const r of rows as { pair: string; ft: number; line: number; over: string; under: string }[]) {
      if (!Number.isFinite(r.line)) continue;
      const ou = parseFloat(r.under), oo = parseFloat(r.over);
      const a = agg.get(r.pair) || { n: 0, xPnl: 0, xW: 0, xL: 0, tPnl: 0, tW: 0, tL: 0, lineSum: 0 };
      a.n++; a.lineSum += r.line;
      if (Number.isFinite(ou)) { const p = grade(r.line, r.ft, ou, false); a.xPnl += p; if (p > 0) a.xW++; else if (p < 0) a.xL++; }
      if (Number.isFinite(oo)) { const p = grade(r.line, r.ft, oo, true); a.tPnl += p; if (p > 0) a.tW++; else if (p < 0) a.tL++; }
      agg.set(r.pair, a);
    }

    const pairs = [...agg.entries()].map(([pair, a]) => ({
      pair,
      n: a.n,
      avgLine: Math.round((a.lineSum / a.n) * 100) / 100,
      xiuRoi: Math.round((1000 * a.xPnl) / a.n) / 10,
      xiuWr: a.xW + a.xL ? Math.round((1000 * a.xW) / (a.xW + a.xL)) / 10 : 0,
      taiRoi: Math.round((1000 * a.tPnl) / a.n) / 10,
      taiWr: a.tW + a.tL ? Math.round((1000 * a.tW) / (a.tW + a.tL)) / 10 : 0,
    }));

    // Phân loại theo cửa XỈU: whitelist = Xỉu tốt (đánh XỈU); blacklist = Xỉu kém = nổ Tài (đánh TÀI).
    const whitelist = pairs.filter((p) => p.n >= MIN_N && p.xiuRoi >= MIN_ROI).sort((a, b) => b.xiuRoi - a.xiuRoi);
    const blacklist = pairs.filter((p) => p.n >= MIN_N && p.xiuRoi <= -MIN_ROI).sort((a, b) => b.taiRoi - a.taiRoi); // xếp theo ROI TÀI giảm dần
    const gray = pairs.filter((p) => p.n >= MIN_N && p.xiuRoi > -MIN_ROI && p.xiuRoi < MIN_ROI);

    const data = {
      ok: true,
      days,
      updatedAt: new Date().toISOString(),
      total: rows.length,
      minN: MIN_N,
      minRoi: MIN_ROI,
      whitelist,
      blacklist,
      gray,
    };
    // Ghi cache DB (tạo bảng nếu chưa có) → lần sau đọc nhanh; job đêm cũng ghi vào đây.
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS gs_ft_backtest_cache (days text PRIMARY KEY, computed_at timestamptz, data jsonb)`);
      await db.query(`INSERT INTO gs_ft_backtest_cache(days, computed_at, data) VALUES($1, now(), $2)
                      ON CONFLICT (days) DO UPDATE SET computed_at=now(), data=$2`, [days, JSON.stringify(data)]);
    } catch { /* noop */ }
    return Response.json(data);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
