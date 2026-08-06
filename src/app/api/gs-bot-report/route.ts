import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set (mirror the other gs-* routes).
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── Config ────────────────────────────────────────────────────────────────────
// 2 bots requested. `calc_version` is the DB key; `label` is what the UI shows.
const BOTS: { calcVersion: string; label: string; side: 'xiu' | 'tai' }[] = [
  { calcVersion: 'V.Bot 12 R4-B', label: 'XỈU / R4-B', side: 'xiu' },
  { calcVersion: 'V.Bot 14', label: 'TÀI / V.Bot14', side: 'tai' },
];

// 4 time buckets (VN / Asia/Bangkok), hour // 6.
const BUCKET_COUNT = 4;
export const BUCKET_LABELS = ['00-06h', '06-12h', '12-18h', '18-24h'];
// "Recent" window for the golden-window ranking: last N days (by distinct dates present).
const RECENT_DAYS = 3;

// ── Types ───────────────────────────────────────────────────────────────────

export interface BotCell {
  w: number; // win + half-win (as counts)
  l: number; // lose + half-lose
  n: number; // graded legs (w + l); push/null excluded
  net: number; // sum(pnl) over graded legs
  wr: number | null; // w / (w + l), null when n = 0
}

// One time-bucket row across all days + its consistency verdict.
export interface BucketRow {
  bucket: number; // 0..3
  label: string; // '06-12h'
  cells: (BotCell | null)[]; // aligned to `days`; null = no data that day
  net: number; // total net across all days for this bucket
  // Consistency across the days that HAVE data:
  posDays: number; // days with net > 0
  negDays: number; // days with net < 0
  daysWithData: number;
  consistency: 'stable-pos' | 'stable-neg' | 'noisy' | 'flat' | 'empty';
}

// Golden-window ranking — recent-weighted, NOT cumulative (cumulative hides decay).
export interface WindowRank {
  bucket: number;
  label: string;
  recentNet: number; // net over last RECENT_DAYS days
  recentWr: number | null;
  histNet: number; // net over ALL days (for decay compare)
  decaying: boolean; // recent noticeably worse than the historical average → edge dying
}

export interface BotReport {
  calcVersion: string;
  label: string;
  side: 'xiu' | 'tai';
  rows: BucketRow[]; // 4 buckets
  dayNet: (number | null)[]; // TỔNG net per day (aligned to `days`)
  totalNet: number;
  best: WindowRank | null; // best recent bucket
  worst: WindowRank | null; // worst recent bucket
  decayFlag: boolean; // any bucket decaying → ⚠️ warn
}

export interface BotReportResponse {
  ok: boolean;
  error?: string;
  days: string[]; // YYYY-MM-DD, ascending
  recentDays: string[]; // the last RECENT_DAYS of `days` used for the golden window
  bucketLabels: string[];
  bots: BotReport[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMPTY_RESPONSE: BotReportResponse = {
  ok: true,
  days: [],
  recentDays: [],
  bucketLabels: BUCKET_LABELS,
  bots: [],
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// One (calc_version, day, bucket) aggregate row from Postgres.
interface AggDbRow {
  calc_version: string;
  d: string; // YYYY-MM-DD (local date, text)
  bucket: number | string; // 0..3
  w: number | string;
  l: number | string;
  net: number | string | null;
}

function buildCell(w: number, l: number, net: number): BotCell {
  const n = w + l;
  return { w, l, n, net: round2(net), wr: n > 0 ? w / n : null };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const pool = getPool();
  if (!pool) return Response.json(EMPTY_RESPONSE satisfies BotReportResponse);

  try {
    const calcVersions = BOTS.map((b) => b.calcVersion);

    // Single scan: aggregate wins / losses / net per (bot, local-day, 6h-bucket).
    // win + half-win → w ; lose + half-lose → l ; push / null excluded from all.
    const aggRes = await pool.query<AggDbRow>(
      `SELECT calc_version,
              to_char((entry_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS d,
              (EXTRACT(HOUR FROM entry_at AT TIME ZONE 'Asia/Bangkok')::int / 6)  AS bucket,
              COUNT(*) FILTER (WHERE result IN ('win', 'half-win'))   AS w,
              COUNT(*) FILTER (WHERE result IN ('lose', 'half-lose')) AS l,
              COALESCE(SUM(pnl) FILTER (WHERE result IS NOT NULL), 0) AS net
         FROM gs_tx_paper
        WHERE calc_version = ANY($1)
        GROUP BY 1, 2, 3`,
      [calcVersions],
    );

    // Distinct days (ascending) across both bots — shared column axis.
    const daySet = new Set<string>();
    for (const r of aggRes.rows) daySet.add(r.d);
    const days = [...daySet].sort();
    const dayIdx = new Map(days.map((d, i) => [d, i]));
    const recentDays = days.slice(-RECENT_DAYS);
    const recentSet = new Set(recentDays);

    // Index raw cells by bot → bucket → dayIndex.
    // agg[calcVersion][bucket][dayIdx] = { w, l, net }
    const agg = new Map<string, { w: number; l: number; net: number }[][]>();
    for (const b of BOTS) {
      agg.set(
        b.calcVersion,
        Array.from({ length: BUCKET_COUNT }, () => days.map(() => ({ w: 0, l: 0, net: 0 }))),
      );
    }
    for (const r of aggRes.rows) {
      const buckets = agg.get(r.calc_version);
      if (!buckets) continue;
      const bi = num(r.bucket);
      const di = dayIdx.get(r.d);
      if (bi < 0 || bi >= BUCKET_COUNT || di == null) continue;
      buckets[bi][di] = { w: num(r.w), l: num(r.l), net: num(r.net) };
    }

    const bots: BotReport[] = BOTS.map((b) => {
      const buckets = agg.get(b.calcVersion)!;

      const rows: BucketRow[] = buckets.map((perDay, bucket) => {
        const cells: (BotCell | null)[] = perDay.map((c) =>
          c.w + c.l === 0 && c.net === 0 ? null : buildCell(c.w, c.l, c.net),
        );
        let net = 0;
        let posDays = 0;
        let negDays = 0;
        let daysWithData = 0;
        for (const cell of cells) {
          if (!cell) continue;
          daysWithData += 1;
          net += cell.net;
          if (cell.net > 0) posDays += 1;
          else if (cell.net < 0) negDays += 1;
        }
        let consistency: BucketRow['consistency'];
        if (daysWithData === 0) consistency = 'empty';
        else if (posDays > 0 && negDays === 0) consistency = 'stable-pos';
        else if (negDays > 0 && posDays === 0) consistency = 'stable-neg';
        else if (posDays === 0 && negDays === 0) consistency = 'flat';
        else consistency = 'noisy';
        return {
          bucket,
          label: BUCKET_LABELS[bucket],
          cells,
          net: round2(net),
          posDays,
          negDays,
          daysWithData,
          consistency,
        };
      });

      // TỔNG net per day (column totals).
      const dayNet: (number | null)[] = days.map((_, di) => {
        let sum = 0;
        let any = false;
        for (const row of rows) {
          const cell = row.cells[di];
          if (cell) {
            sum += cell.net;
            any = true;
          }
        }
        return any ? round2(sum) : null;
      });
      const totalNet = round2(dayNet.reduce<number>((a, v) => a + (v ?? 0), 0));

      // Golden window — rank buckets by RECENT net (last RECENT_DAYS), not cumulative.
      // Cumulative hides decay: a bucket can be +9 lifetime yet dead in the last day.
      const ranks: WindowRank[] = rows.map((row) => {
        let recentW = 0;
        let recentL = 0;
        let recentNet = 0;
        let histNet = 0;
        // Per-day net for the days that actually traded (chronological) — used
        // to compare the newest day against the earlier ones (decay detection).
        const dayNets: number[] = [];
        days.forEach((day, di) => {
          const cell = row.cells[di];
          if (!cell) return;
          histNet += cell.net;
          dayNets.push(cell.net);
          if (recentSet.has(day)) {
            recentW += cell.w;
            recentL += cell.l;
            recentNet += cell.net;
          }
        });
        const recentN = recentW + recentL;
        // Decay: history was healthy (net > 0) but the LATEST traded day for this
        // bucket has turned negative / fallen well below the earlier per-day mean.
        // Cumulative "+9u looks golden" hides this — e.g. +11.2 then −2.0.
        let decaying = false;
        if (histNet > 0 && dayNets.length >= 2) {
          const last = dayNets[dayNets.length - 1];
          const prior = dayNets.slice(0, -1);
          const priorMean = prior.reduce((a, v) => a + v, 0) / prior.length;
          decaying = last < 0 || last < priorMean - 1.5;
        }
        return {
          bucket: row.bucket,
          label: row.label,
          recentNet: round2(recentNet),
          recentWr: recentN > 0 ? recentW / recentN : null,
          histNet: round2(histNet),
          decaying,
        };
      });

      // Rank only buckets that actually traded, by RECENT net (golden window).
      const rankable = ranks.filter((r) => rows[r.bucket].daysWithData > 0);
      const best =
        rankable.length > 0 ? [...rankable].sort((a, b2) => b2.recentNet - a.recentNet)[0] : null;
      const worst =
        rankable.length > 0 ? [...rankable].sort((a, b2) => a.recentNet - b2.recentNet)[0] : null;
      const decayFlag = ranks.some((r) => r.decaying);

      return {
        calcVersion: b.calcVersion,
        label: b.label,
        side: b.side,
        rows,
        dayNet,
        totalNet,
        best,
        worst,
        decayFlag,
      };
    });

    return Response.json({
      ok: true,
      days,
      recentDays,
      bucketLabels: BUCKET_LABELS,
      bots,
    } satisfies BotReportResponse);
  } catch (e) {
    return Response.json({ ...EMPTY_RESPONSE, ok: false, error: String(e) } satisfies BotReportResponse);
  }
}
