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

// Một mốc 1h (giờ VN). pnl = tổng PnL kèo đã chấm vào giờ đó; cumulative = luỹ kế từ đầu range.
export interface TxTimelineBucket {
  i: number; // 0..(days*24-1)
  dateVn: string; // 'YYYY-MM-DD' theo giờ VN
  hourVn: number; // 0..23
  pnl: number; // delta PnL trong giờ này (chỉ kèo đã chấm)
  cumulative: number; // PnL luỹ kế từ đầu range
  bets: number; // số kèo đã chấm trong giờ
}

export interface TxTimelineResponse {
  ok: boolean;
  error?: string;
  version: string | null; // version đang active (latest) — chart chỉ theo version này
  date: string; // ngày cuối range (VN) 'YYYY-MM-DD'
  days: number; // 1 | 3 | 7 | 30
  buckets: TxTimelineBucket[]; // days*24 mốc
  totalPnl: number; // = cumulative cuối cùng
  totalBets: number;
}

// ── Helpers giờ VN (UTC+7) — cùng pattern +7h với matchUtils/TxReport ─────────

const HOUR_MS = 3_600_000;
const VN_OFFSET_MS = 7 * HOUR_MS;
const ALLOWED_DAYS = [1, 3, 7, 30];

const pad = (n: number): string => String(n).padStart(2, '0');

// Các thành phần "wall-clock" giờ VN của một mốc thời gian.
function vnParts(d: Date): { y: number; m: number; day: number; hour: number } {
  const v = new Date(d.getTime() + VN_OFFSET_MS);
  return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, day: v.getUTCDate(), hour: v.getUTCHours() };
}
function vnDateStr(d: Date): string {
  const p = vnParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.day)}`;
}
// Mốc UTC ứng với 00:00 giờ VN của 'YYYY-MM-DD' (VN 00:00 = UTC ngày đó 00:00 − 7h).
function vnMidnightUtc(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`) - VN_OFFSET_MS;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const daysParam = Number(searchParams.get('days'));
  const days = ALLOWED_DAYS.includes(daysParam) ? daysParam : 1;
  const dateParam = searchParams.get('date');
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '') ? (dateParam as string) : vnDateStr(new Date());
  const versionParam = searchParams.get('version'); // cụ thể | 'all' | null → theo version chọn ở bảng

  const empty: TxTimelineResponse = { ok: true, version: null, date: endDate, days, buckets: [], totalPnl: 0, totalBets: 0 };

  const pool = getPool();
  if (!pool) return Response.json(empty satisfies TxTimelineResponse);

  try {
    // Version chart bám theo lựa chọn ở bảng: version cụ thể → dùng thẳng;
    // 'all' hoặc trống → version active = mới nhất theo MAX(entry_at).
    let version: string | null;
    if (versionParam && versionParam !== 'all') {
      version = versionParam;
    } else {
      const vRes = await pool.query<{ calc_version: string }>(
        `SELECT calc_version FROM gs_tx_paper GROUP BY calc_version ORDER BY MAX(entry_at) DESC LIMIT 1`,
      );
      version = vRes.rows[0]?.calc_version ?? null;
    }
    if (!version) return Response.json(empty satisfies TxTimelineResponse);

    // Range UTC [start, end): endDate 00:00→24:00 VN, lùi về (days−1) ngày.
    const endMidnightUtc = vnMidnightUtc(endDate);
    const rangeStartUtc = endMidnightUtc - (days - 1) * 24 * HOUR_MS;
    const rangeEndUtc = endMidnightUtc + 24 * HOUR_MS;

    const rowsRes = await pool.query<{ entry_at: string | Date; pnl: string | number | null; result: string | null }>(
      `SELECT entry_at, pnl, result
         FROM gs_tx_paper
        WHERE calc_version = $1 AND entry_at >= $2 AND entry_at < $3`,
      [version, new Date(rangeStartUtc).toISOString(), new Date(rangeEndUtc).toISOString()],
    );

    // 24·days mốc, mỗi mốc 1h — gán nhãn ngày/giờ VN từ mốc bắt đầu bucket.
    const nBuckets = days * 24;
    const buckets: TxTimelineBucket[] = [];
    for (let i = 0; i < nBuckets; i++) {
      const p = vnParts(new Date(rangeStartUtc + i * HOUR_MS));
      buckets.push({ i, dateVn: `${p.y}-${pad(p.m)}-${pad(p.day)}`, hourVn: p.hour, pnl: 0, cumulative: 0, bets: 0 });
    }

    for (const r of rowsRes.rows) {
      if (r.result == null) continue; // chỉ kèo đã chấm mới có pnl
      const idx = Math.floor((new Date(r.entry_at).getTime() - rangeStartUtc) / HOUR_MS);
      if (idx < 0 || idx >= nBuckets) continue;
      const pnl = r.pnl == null ? 0 : Number(r.pnl);
      buckets[idx].pnl += Number.isFinite(pnl) ? pnl : 0;
      buckets[idx].bets += 1;
    }

    let run = 0;
    let totalBets = 0;
    for (const b of buckets) {
      b.pnl = round3(b.pnl);
      run += b.pnl;
      b.cumulative = round3(run);
      totalBets += b.bets;
    }

    // Cắt mốc rỗng ở ĐẦU và CUỐI range (ngày quá khứ / giờ chưa tới không có kèo) →
    // chỉ vẽ từ mốc có kèo đầu tiên đến mốc có kèo cuối cùng. Khoảng trống Ở GIỮA giữ nguyên
    // (đó là "ngày không phát sinh PnL" thật). Re-index i về 0..k để trục X khớp vị trí.
    const first = buckets.findIndex((b) => b.bets > 0);
    let last = -1;
    for (let k = buckets.length - 1; k >= 0; k--) {
      if (buckets[k].bets > 0) {
        last = k;
        break;
      }
    }
    const trimmed = first === -1 ? [] : buckets.slice(first, last + 1).map((b, idx) => ({ ...b, i: idx }));

    return Response.json({
      ok: true,
      version,
      date: endDate,
      days,
      buckets: trimmed,
      totalPnl: round3(run),
      totalBets,
    } satisfies TxTimelineResponse);
  } catch (e) {
    return Response.json({ ...empty, ok: false, error: String(e) } satisfies TxTimelineResponse);
  }
}
