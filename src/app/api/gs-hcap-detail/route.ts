import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set (mirror gs-hcap-report).
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// Nhãn tiếng Việt cho leg (khớp gs-hcap-report).
const LEG_LABEL: Record<string, string> = {
  fav_hc: 'Kèo trên',
  und_hc: 'Kèo dưới',
  over: 'Tài',
};

// ── Row shape trả ra FE (drawer chi tiết handicap) ──────────────────────────
export interface HcapDetailRow {
  id: number;
  requestedAt: string; // ISO — thời điểm đặt kèo (requested_at)
  settledAt: string | null; // ISO — thời điểm chấm (settled_at), null nếu chưa chấm
  homeTeam: string;
  awayTeam: string;
  matchType: string;
  leg: string;         // fav_hc | und_hc | over
  legLabel: string;    // nhãn VN
  side: string | null;
  line: number | null;
  odds: number | null;
  homeGives: boolean | null; // home là đội chấp?
  trigMinute: number | null;
  trigScore: string | null;
  result: 'win' | 'half-win' | 'lose' | 'half-lose' | 'push' | null;
  cashPnl: number | null;
  finalHome: number | null;
  finalAway: number | null;
}
export interface HcapDetailResponse {
  ok: boolean;
  error?: string;
  model: string;
  rows: HcapDetailRow[];
}

interface DbRow {
  id: number;
  requested_at: string;
  settled_at: string | null;
  home_team: string | null;
  away_team: string | null;
  match_type: string | null;
  leg: string | null;
  side: string | null;
  line: number | string | null;
  odds: number | string | null;
  home_gives: boolean | null;
  trig_minute: number | null;
  trig_score: string | null;
  result: string | null;
  cash_pnl: number | string | null;
  final_home: number | null;
  final_away: number | null;
}

const numOrNull = (v: number | string | null): number | null =>
  v == null || v === '' ? null : Number(v);

// gs_hcap_paper lưu 'loss'/'half-loss' — chuẩn hoá về 'lose'/'half-lose' cho khớp KqCell (giống báo cáo TX).
function normResult(v: string | null): HcapDetailRow['result'] {
  if (v == null || v === '') return null;
  if (v === 'loss') return 'lose';
  if (v === 'half-loss') return 'half-lose';
  return v as HcapDetailRow['result'];
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) {
    return Response.json(
      { ok: false, error: 'ANALYSIS_DATABASE_URL chưa cấu hình', model: '', rows: [] } as HcapDetailResponse,
      { status: 200 },
    );
  }

  const modelParam = (req.nextUrl.searchParams.get('model') ?? '').toUpperCase();
  const model = ['A', 'B', 'C'].includes(modelParam) ? modelParam : 'A';

  try {
    const res = await pool.query<DbRow>(
      `SELECT id, requested_at, settled_at, home_team, away_team, match_type, leg, side, line, odds,
              home_gives, trig_minute, trig_score, result, cash_pnl, final_home, final_away
         FROM gs_hcap_paper
        WHERE model = $1 AND status = 'paper_signal'
        ORDER BY requested_at DESC
        LIMIT 100`,
      [model],
    );

    const rows: HcapDetailRow[] = res.rows.map((r) => ({
      id: r.id,
      requestedAt: new Date(r.requested_at).toISOString(),
      settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
      homeTeam: r.home_team ?? '?',
      awayTeam: r.away_team ?? '?',
      matchType: r.match_type ?? '—',
      leg: r.leg ?? '—',
      legLabel: (r.leg && LEG_LABEL[r.leg]) || r.leg || '—',
      side: r.side,
      line: numOrNull(r.line),
      odds: numOrNull(r.odds),
      homeGives: r.home_gives,
      trigMinute: r.trig_minute,
      trigScore: r.trig_score,
      result: normResult(r.result),
      cashPnl: numOrNull(r.cash_pnl),
      finalHome: r.final_home,
      finalAway: r.final_away,
    }));

    return Response.json({ ok: true, model, rows } as HcapDetailResponse, { status: 200 });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), model, rows: [] } as HcapDetailResponse,
      { status: 200 },
    );
  }
}
