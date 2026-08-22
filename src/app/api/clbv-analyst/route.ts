import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/clbv-analyst — read the current gs_clbv_analyst table (rebuilt by POST
// /api/clbv-analyst/sync). Câu Lạc Bộ 20p league only.

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

export interface ClbvAnalystRow {
  teamId: number;
  teamName: string;
  fullN: number | null; fullTaiRate: number | null; fullTaiAvgGoals: number | null;
  fullXiuRate: number | null; fullXiuAvgGoals: number | null;
  h1N: number | null; h1TaiRate: number | null; h1TaiAvgGoals: number | null;
  h1XiuRate: number | null; h1XiuAvgGoals: number | null;
  h2N: number | null;
  h2TaiRate: number | null; h2TaiAvgGoals: number | null;
  h2XiuRate: number | null; h2XiuAvgGoals: number | null;
  rungH1N: number | null; rungH1Rate: number | null; rungH1AvgGoals: number | null;
  rungH2N: number | null; rungH2Rate: number | null; rungH2AvgGoals: number | null;
  windowDays: number;
  updatedAt: string;
}

interface RawRow {
  team_id: number;
  team_name: string;
  full_n: number | null; full_tai_rate: string | null; full_tai_avg_goals: string | null;
  full_xiu_rate: string | null; full_xiu_avg_goals: string | null;
  h1_n: number | null; h1_tai_rate: string | null; h1_tai_avg_goals: string | null;
  h1_xiu_rate: string | null; h1_xiu_avg_goals: string | null;
  h2_n: number | null;
  h2_tai_rate: string | null; h2_tai_avg_goals: string | null;
  h2_xiu_rate: string | null; h2_xiu_avg_goals: string | null;
  rung_h1_n: number | null; rung_h1_rate: string | null; rung_h1_avg_goals: string | null;
  rung_h2_n: number | null; rung_h2_rate: string | null; rung_h2_avg_goals: string | null;
  window_days: number;
  updated_at: string;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToApi(r: RawRow): ClbvAnalystRow {
  return {
    teamId: r.team_id,
    teamName: r.team_name,
    fullN: r.full_n, fullTaiRate: num(r.full_tai_rate), fullTaiAvgGoals: num(r.full_tai_avg_goals),
    fullXiuRate: num(r.full_xiu_rate), fullXiuAvgGoals: num(r.full_xiu_avg_goals),
    h1N: r.h1_n, h1TaiRate: num(r.h1_tai_rate), h1TaiAvgGoals: num(r.h1_tai_avg_goals),
    h1XiuRate: num(r.h1_xiu_rate), h1XiuAvgGoals: num(r.h1_xiu_avg_goals),
    h2N: r.h2_n,
    h2TaiRate: num(r.h2_tai_rate), h2TaiAvgGoals: num(r.h2_tai_avg_goals),
    h2XiuRate: num(r.h2_xiu_rate), h2XiuAvgGoals: num(r.h2_xiu_avg_goals),
    rungH1N: r.rung_h1_n, rungH1Rate: num(r.rung_h1_rate), rungH1AvgGoals: num(r.rung_h1_avg_goals),
    rungH2N: r.rung_h2_n, rungH2Rate: num(r.rung_h2_rate), rungH2AvgGoals: num(r.rung_h2_avg_goals),
    windowDays: r.window_days,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function GET() {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' });

  try {
    const { rows } = await pool.query<RawRow>(
      `SELECT team_id, team_name,
              full_n, full_tai_rate, full_tai_avg_goals, full_xiu_rate, full_xiu_avg_goals,
              h1_n, h1_tai_rate, h1_tai_avg_goals, h1_xiu_rate, h1_xiu_avg_goals,
              h2_n, h2_tai_rate, h2_tai_avg_goals, h2_xiu_rate, h2_xiu_avg_goals,
              rung_h1_n, rung_h1_rate, rung_h1_avg_goals,
              rung_h2_n, rung_h2_rate, rung_h2_avg_goals,
              window_days, updated_at
       FROM gs_clbv_analyst
       ORDER BY team_name ASC`
    );
    const latestUpdatedAt = rows.reduce<string | null>((max, r) => {
      const iso = new Date(r.updated_at).toISOString();
      return !max || iso > max ? iso : max;
    }, null);
    return Response.json({
      ok: true,
      rows: rows.map(rowToApi),
      windowDays: rows[0]?.window_days ?? 7,
      updatedAt: latestUpdatedAt,
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
