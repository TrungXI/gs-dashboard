import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set (same pattern as gs-bets)
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Row / summary shapes ────────────────────────────────────────────────────
export interface HcWatchRow {
  event_id: number;
  match_date: string | null;
  home_team: string | null;
  away_team: string | null;
  fav_team: string | null;   // đội ĐƯỢC ra kèo giá -0.3..-0.5
  opp_team: string | null;
  minute: number | null;
  half: string | null;       // 'H2' | 'FULL'
  side: string | null;       // 'HOME' | 'AWAY'
  entry_score: string | null;
  handicap: string | null;   // '-0.25' / '+0.0' ...
  price: string | null;      // '-0.33' ...
  ht: string | null;
  ft: string | null;
  post_margin: number | null;
  ket_qua: string | null;    // AN | an-nua | hoa-von | thua-nua | THUA
  pnl_unit: string | null;
}
export interface HcWatchSummary {
  team: string;
  n: number;
  an1trai: number;   pct_an1: number;    // post_margin >= 1  (ăn 1 trái)
  hoa_plus: number;  pct_hoaplus: number;// post_margin >= 0  (gỡ/hòa+)
  an: number; thua: number; pnl: number;
}

const ROW_COLS = `event_id, match_date, home_team, away_team, fav_team, opp_team,
  minute, half, side, entry_score, handicap, price, ht, ft, post_margin, ket_qua, pnl_unit`;

// Per-team summary computed on the rows where the team is the FAVORED side.
async function teamSummary(pool: Pool, team: string): Promise<HcWatchSummary> {
  const { rows } = await pool.query(
    `SELECT count(*)::int n,
       count(*) FILTER (WHERE post_margin >= 1)::int an1trai,
       count(*) FILTER (WHERE post_margin >= 0)::int hoa_plus,
       count(*) FILTER (WHERE pnl_unit > 0)::int an,
       count(*) FILTER (WHERE pnl_unit < 0)::int thua,
       COALESCE(round(sum(pnl_unit),2),0)::float8 pnl
     FROM gs_hc_price_watch WHERE fav_team = $1`, [team]);
  const r = rows[0];
  const pct = (x: number) => (r.n ? Math.round((100 * x) / r.n) : 0);
  return {
    team, n: r.n, an1trai: r.an1trai, pct_an1: pct(r.an1trai),
    hoa_plus: r.hoa_plus, pct_hoaplus: pct(r.hoa_plus),
    an: r.an, thua: r.thua, pnl: r.pnl,
  };
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ error: 'ANALYSIS_DATABASE_URL not set' }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const team = sp.get('team')?.trim();
  const home = sp.get('home')?.trim();
  const away = sp.get('away')?.trim();

  try {
    // Mode PAIR: chỉ các kèo band từng xuất hiện của đúng cặp (cả 2 chiều sân)
    if (home && away) {
      const { rows } = await pool.query(
        `SELECT ${ROW_COLS} FROM gs_hc_price_watch
         WHERE (home_team=$1 AND away_team=$2) OR (home_team=$2 AND away_team=$1)
         ORDER BY event_id DESC`, [home, away]);
      return Response.json({
        mode: 'pair', home, away, rows,
        summary: [await teamSummary(pool, home), await teamSummary(pool, away)],
      });
    }
    // Mode TEAM: mọi kèo band có đội này (đội là fav hoặc opp) + tỉ lệ khi đội = fav
    if (team) {
      const { rows } = await pool.query(
        `SELECT ${ROW_COLS} FROM gs_hc_price_watch
         WHERE home_team=$1 OR away_team=$1 ORDER BY event_id DESC`, [team]);
      return Response.json({ mode: 'team', team, rows, summary: [await teamSummary(pool, team)] });
    }
    return Response.json({ error: 'cần ?team= hoặc ?home=&away=' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
