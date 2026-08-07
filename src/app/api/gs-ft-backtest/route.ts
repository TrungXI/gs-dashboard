import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Backtest FT-XỈU per-CẶP: loop gs_matches_history (tổng bàn THẬT) × line MỞ 0-0 (match_odds_log,
// neo team + recorded_at±25'). Chấm Malay + line lẻ → ROI/winrate + line mở trung bình mỗi cặp.
// Nặng (~9s) → cache in-memory 10 phút.

const MIN_N = 25;
const MIN_ROI = 3; // %

let _cache: { at: number; data: unknown } | null = null;
const TTL = 10 * 60 * 1000;

let _pool: Pool | null = null;
function pool(): Pool | null {
  const url = process.env.ANALYSIS_DATABASE_URL;
  if (!url) return null;
  if (!_pool) _pool = new Pool({ connectionString: url, max: 2 });
  return _pool;
}

// Chấm 1 kèo XỈU: line L, tổng bàn ft, odds Malay Xỉu o → pnl (cược 1 đơn vị).
function grade(L: number, ft: number, o: number): number {
  const wamt = o >= 0 ? o : 1;
  const lamt = o >= 0 ? -1 : o;
  const fl = Math.floor(L);
  const frac = Math.round((L - fl) * 100) / 100;
  if (frac === 0) return ft < L ? wamt : ft > L ? lamt : 0;
  if (frac === 0.5) return ft < L ? wamt : lamt;
  if (frac === 0.25) return ft < fl ? wamt : ft === fl ? wamt / 2 : lamt;
  return ft <= fl ? wamt : ft === fl + 1 ? lamt / 2 : lamt;
}

export async function GET() {
  if (_cache && Date.now() - _cache.at < TTL) return Response.json(_cache.data);
  const db = pool();
  if (!db) return Response.json({ ok: false, error: 'no db' });

  try {
    const { rows } = await db.query(`
      SELECT least(ht.name, at.name) || '|' || greatest(ht.name, at.name) AS pair,
             (mh.tt_home + mh.tt_away)::int AS ft, o.line::float AS line, o.xodds
      FROM gs_matches_history mh
      JOIN gs_teams ht ON ht.id = mh.home_team_id
      JOIN gs_teams at ON at.id = mh.away_team_id
      LEFT JOIN LATERAL (
        SELECT ol.ou_line::numeric AS line, ol.ou_under AS xodds
        FROM match_odds_log ol
        WHERE ol.match_type = mh.match_type AND ol.score_home = 0 AND ol.score_away = 0
          AND ol.ou_line ~ '^[0-9.]+$'
          AND ( (replace(ol.home_team,' (V)','') = ht.name AND replace(ol.away_team,' (V)','') = at.name)
             OR (replace(ol.home_team,' (V)','') = at.name AND replace(ol.away_team,' (V)','') = ht.name) )
          AND ol.recorded_at BETWEEN mh.match_time - interval '25 min' AND mh.match_time + interval '25 min'
        ORDER BY ol.recorded_at, ol.id LIMIT 1
      ) o ON true
      WHERE ht.type = 'V' AND at.type = 'V' AND mh.match_type = '20p'
        AND mh.tt_home IS NOT NULL AND o.line IS NOT NULL`);

    const agg = new Map<string, { n: number; pnl: number; win: number; lose: number; lineSum: number }>();
    for (const r of rows as { pair: string; ft: number; line: number; xodds: string }[]) {
      const o = parseFloat(r.xodds);
      if (!Number.isFinite(o) || !Number.isFinite(r.line)) continue;
      const p = grade(r.line, r.ft, o);
      const a = agg.get(r.pair) || { n: 0, pnl: 0, win: 0, lose: 0, lineSum: 0 };
      a.n++; a.pnl += p; a.lineSum += r.line;
      if (p > 0) a.win++; else if (p < 0) a.lose++;
      agg.set(r.pair, a);
    }

    const pairs = [...agg.entries()].map(([pair, a]) => ({
      pair,
      n: a.n,
      roi: Math.round((1000 * a.pnl) / a.n) / 10,
      wr: a.win + a.lose ? Math.round((1000 * a.win) / (a.win + a.lose)) / 10 : 0,
      avgLine: Math.round((a.lineSum / a.n) * 100) / 100,
    })).sort((x, y) => y.roi - x.roi);

    const whitelist = pairs.filter((p) => p.n >= MIN_N && p.roi >= MIN_ROI);
    const blacklist = pairs.filter((p) => p.n >= MIN_N && p.roi <= -MIN_ROI).reverse();
    const gray = pairs.filter((p) => p.n >= MIN_N && p.roi > -MIN_ROI && p.roi < MIN_ROI);

    const data = {
      ok: true,
      updatedAt: new Date().toISOString(),
      total: rows.length,
      minN: MIN_N,
      minRoi: MIN_ROI,
      whitelist,
      blacklist,
      gray,
    };
    _cache = { at: Date.now(), data };
    return Response.json(data);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
