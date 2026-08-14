import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set.
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Types ───────────────────────────────────────────────────────────────────

// Cùng shape với TxAggLine của báo cáo TX (bets/win/lose/winRate/pnl) + pending riêng.
export interface HcapAggLine {
  bets: number; // số kèo đã chấm (result IS NOT NULL)
  win: number;
  halfWin: number;
  lose: number;
  halfLose: number;
  push: number;
  winRate: number | null; // (win + 0.5·halfWin) / (win + 0.5·halfWin + lose + 0.5·halfLose)
  pnl: number;
  pending: number; // kèo chưa chấm (result IS NULL)
}

export interface HcapTypeAgg extends HcapAggLine {
  matchType: string; // '16p' | '20p' | '20p_intl'
}

export interface HcapLegAgg {
  leg: string; // 'fav_hc' | 'und_hc' | 'over'
  label: string; // nhãn tiếng Việt cho leg
  byType: HcapTypeAgg[]; // tách theo match_type (chỉ type có data)
  total: HcapAggLine; // gộp mọi match_type của leg này
}

export interface HcapModelAgg {
  model: string; // 'A' | 'B' | 'C'
  label: string; // nhãn hiển thị
  byLeg: HcapLegAgg[]; // mỗi leg riêng (Model B có 2 leg)
  total: HcapAggLine; // gộp mọi leg + mọi type
}

export interface HcapReportResponse {
  ok: boolean;
  error?: string;
  models: HcapModelAgg[];
}

// ── Nhãn cố định (SPEC) ──────────────────────────────────────────────────────

const MODEL_LABEL: Record<string, string> = {
  A: 'Trên tiếp H2 (16p)',
  B: 'Ngược dưới + Tài (20p + Quốc tế)',
  C: 'Thua ít (16p)',
};
const MODEL_ORDER = ['A', 'B', 'C'];

const LEG_LABEL: Record<string, string> = {
  fav_hc: 'Kèo trên',
  und_hc: 'Kèo dưới',
  over: 'Tài',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyAgg = (): HcapAggLine => ({
  bets: 0, win: 0, halfWin: 0, lose: 0, halfLose: 0, push: 0, winRate: null, pnl: 0, pending: 0,
});

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function finalizeLine(line: HcapAggLine): HcapAggLine {
  const winU = line.win + 0.5 * line.halfWin; // nửa-ăn = 0.5 win
  const loseU = line.lose + 0.5 * line.halfLose;
  const decided = winU + loseU;
  line.winRate = decided > 0 ? winU / decided : null;
  line.pnl = Math.round(line.pnl * 1000) / 1000;
  return line;
}

function addInto(dst: HcapAggLine, src: HcapAggLine) {
  dst.bets += src.bets;
  dst.win += src.win;
  dst.halfWin += src.halfWin;
  dst.lose += src.lose;
  dst.halfLose += src.halfLose;
  dst.push += src.push;
  dst.pnl += src.pnl;
  dst.pending += src.pending;
}

// Một dòng GROUP BY (model, leg, match_type) từ Postgres.
interface AggDbRow {
  model: string;
  leg: string;
  match_type: string | null;
  bets: number | string;
  win: number | string;
  half_win: number | string;
  lose: number | string;
  half_lose: number | string;
  push: number | string;
  pending: number | string;
  pnl: number | string | null;
}

function lineFromDb(r: AggDbRow): HcapAggLine {
  return {
    bets: num(r.bets),
    win: num(r.win),
    halfWin: num(r.half_win),
    lose: num(r.lose),
    halfLose: num(r.half_lose),
    push: num(r.push),
    winRate: null,
    pnl: num(r.pnl),
    pending: num(r.pending),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const pool = getPool();
  if (!pool) return Response.json({ ok: true, models: [] } satisfies HcapReportResponse);

  try {
    // GROUP BY (model, leg, match_type) — chỉ kèo paper thật (status='paper_signal'),
    // bỏ book_locked (nhà cái khoá, không phải kèo vào thật).
    const aggRes = await pool.query<AggDbRow>(
      `SELECT model, leg, match_type,
              COUNT(*) FILTER (WHERE result IS NOT NULL)::int      AS bets,
              COUNT(*) FILTER (WHERE result = 'win')::int          AS win,
              COUNT(*) FILTER (WHERE result = 'half-win')::int     AS half_win,
              COUNT(*) FILTER (WHERE result = 'lose')::int         AS lose,
              COUNT(*) FILTER (WHERE result = 'half-lose')::int    AS half_lose,
              COUNT(*) FILTER (WHERE result = 'push')::int         AS push,
              COUNT(*) FILTER (WHERE result IS NULL)::int          AS pending,
              COALESCE(SUM(cash_pnl) FILTER (WHERE result IS NOT NULL), 0) AS pnl
         FROM gs_hcap_paper
         WHERE status = 'paper_signal'
         GROUP BY model, leg, match_type`,
    );

    // Gom: model → leg → match_type.
    const modelMap = new Map<string, Map<string, Map<string, HcapAggLine>>>();
    for (const r of aggRes.rows) {
      const mt = r.match_type ?? 'unknown';
      let legMap = modelMap.get(r.model);
      if (!legMap) { legMap = new Map(); modelMap.set(r.model, legMap); }
      let typeMap = legMap.get(r.leg);
      if (!typeMap) { typeMap = new Map(); legMap.set(r.leg, typeMap); }
      typeMap.set(mt, lineFromDb(r));
    }

    // Luôn trả về đủ 3 model A/B/C (kể cả 0 kèo → FE hiện "chưa có kèo").
    const models: HcapModelAgg[] = MODEL_ORDER.map((model) => {
      const legMap = modelMap.get(model) ?? new Map<string, Map<string, HcapAggLine>>();
      const modelTotal = emptyAgg();
      const byLeg: HcapLegAgg[] = [];

      for (const [leg, typeMap] of legMap) {
        const legTotal = emptyAgg();
        const byType: HcapTypeAgg[] = [];
        for (const [matchType, line] of typeMap) {
          const final = finalizeLine({ ...line });
          byType.push({ matchType, ...final });
          addInto(legTotal, line);
          addInto(modelTotal, line);
        }
        byType.sort((a, b) => a.matchType.localeCompare(b.matchType));
        byLeg.push({ leg, label: LEG_LABEL[leg] ?? leg, byType, total: finalizeLine(legTotal) });
      }

      // Thứ tự leg ổn định: dưới trước, Tài sau, rồi phần còn lại.
      const LEG_ORDER: Record<string, number> = { und_hc: 0, over: 1, fav_hc: 2 };
      byLeg.sort((a, b) => (LEG_ORDER[a.leg] ?? 9) - (LEG_ORDER[b.leg] ?? 9));

      return { model, label: MODEL_LABEL[model] ?? model, byLeg, total: finalizeLine(modelTotal) };
    });

    return Response.json({ ok: true, models } satisfies HcapReportResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e), models: [] } satisfies HcapReportResponse);
  }
}
