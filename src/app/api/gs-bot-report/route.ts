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
// `calcVersion` is the stable UI/render key; `label` is what the UI shows.
// `source` picks the table: 'tx' → gs_tx_paper by calc_version, 'hcap' → gs_hcap_paper by model.
// `dbKey` is the value matched in the source table (calc_version for tx, model for hcap);
// defaults to `calcVersion` when omitted (all existing tx bots).
const BOTS: {
  calcVersion: string;
  label: string;
  side: 'xiu' | 'tai';
  source?: 'tx' | 'hcap';
  dbKey?: string;
}[] = [
  { calcVersion: 'V.Bot 14', label: 'TÀI / V.Bot14', side: 'tai' },
  { calcVersion: 'V.Bot 12 Test Full', label: 'XỈU / Test Full', side: 'xiu' },
  { calcVersion: 'V.Bot 12 Test Whitelist', label: 'XỈU / Test Whitelist', side: 'xiu' },
  { calcVersion: 'V.Bot 17 Test BlackList', label: 'TÀI / Test BlackList', side: 'tai' },
  { calcVersion: 'V.Bot 21 QT Xỉu', label: 'V21 QT Xỉu', side: 'xiu' },
  { calcVersion: 'V.Bot Air 1', label: 'Air1 · XỈU theo tỉ số+phút', side: 'xiu' },
  { calcVersion: 'TNK - CLB - Top Rung H1', label: 'TNK CLB · Rung H1 (≥60%)', side: 'tai' },
  { calcVersion: 'TNK - CLB - Top Rung H2', label: 'TNK CLB · Rung H2 (≥60%)', side: 'tai' },
  { calcVersion: 'TNK - CLB - Top Tài H2', label: 'TNK CLB · Tài H2 đầu hiệp (≥60%)', side: 'tai' },
  { calcVersion: 'NVT - CLB - RH2', label: 'NVT CLB · H1 kèo hiệp 1 + H2 kèo cả trận', side: 'tai' },
  // 3 handicap models — same output shape, sourced from gs_hcap_paper by `model`.
  { calcVersion: 'hcap:A', dbKey: 'A', label: 'HC-A · Trên tiếp', side: 'tai', source: 'hcap' },
  { calcVersion: 'hcap:B', dbKey: 'B', label: 'HC-B · Ngược dưới+Tài', side: 'tai', source: 'hcap' },
  { calcVersion: 'hcap:C', dbKey: 'C', label: 'HC-C · Thua ít', side: 'tai', source: 'hcap' },
];

// 8 time buckets (VN / Asia/Bangkok), hour // 3.
const BUCKET_COUNT = 8;
export const BUCKET_LABELS = ['00-03h', '03-06h', '06-09h', '09-12h', '12-15h', '15-18h', '18-21h', '21-24h'];
// "Recent" window for the golden-window ranking: last N days (by distinct dates present).
const RECENT_DAYS = 3;
// Model coi như "đã ngừng chạy" nếu không ra kèo mới quá ngần này ngày (user 2026-08-20).
const STALE_DAYS = 2;

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
  lastActiveAt: string | null; // ISO — MAX(entry_at)/MAX(requested_at), null = chưa từng ra kèo
  stale: boolean; // lastActiveAt null hoặc quá STALE_DAYS ngày → model coi như đã ngừng chạy
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
    // Split bots by source table. tx → gs_tx_paper (by calc_version); hcap → gs_hcap_paper (by model).
    // Each source is keyed by its own db value (`dbKey ?? calcVersion`); we remap the result
    // rows back to the bot's render `calcVersion` so all downstream indexing stays identical.
    const dbKeyOf = (b: (typeof BOTS)[number]) => b.dbKey ?? b.calcVersion;
    const txKeyToRk = new Map<string, string>(); // gs_tx_paper.calc_version → render calcVersion
    const hcapKeyToRk = new Map<string, string>(); // gs_hcap_paper.model     → render calcVersion
    for (const b of BOTS) {
      if (b.source === 'hcap') hcapKeyToRk.set(dbKeyOf(b), b.calcVersion);
      else txKeyToRk.set(dbKeyOf(b), b.calcVersion);
    }

    // Normalized aggregate rows tagged by render calcVersion (rk) — union of both tables.
    const aggRows: { rk: string; d: string; bucket: number; w: number; l: number; net: number }[] = [];

    // gs_tx_paper scan: aggregate wins / losses / net per (bot, local-day, 3h-bucket).
    // win + half-win → w ; lose + half-lose → l ; push / null excluded from all.
    if (txKeyToRk.size > 0) {
      const txRes = await pool.query<AggDbRow>(
        `SELECT calc_version,
                to_char((entry_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS d,
                (EXTRACT(HOUR FROM entry_at AT TIME ZONE 'Asia/Bangkok')::int / 3)  AS bucket,
                COUNT(*) FILTER (WHERE result IN ('win', 'half-win'))   AS w,
                COUNT(*) FILTER (WHERE result IN ('lose', 'half-lose')) AS l,
                COALESCE(SUM(pnl) FILTER (WHERE result IS NOT NULL), 0) AS net
           FROM gs_tx_paper
          WHERE calc_version = ANY($1)
          GROUP BY 1, 2, 3`,
        [[...txKeyToRk.keys()]],
      );
      for (const r of txRes.rows) {
        const rk = txKeyToRk.get(r.calc_version);
        if (rk) aggRows.push({ rk, d: r.d, bucket: num(r.bucket), w: num(r.w), l: num(r.l), net: num(r.net) });
      }
    }

    // gs_hcap_paper scan: same output shape, grouped by (model, local-day, 3h-bucket) via
    // requested_at. Only settled paper signals. win/half-win → w ; lose/half-lose → l ;
    // net = sum(cash_pnl) over graded legs (push/null excluded, mirroring the tx aggregation).
    if (hcapKeyToRk.size > 0) {
      const hcapRes = await pool.query<{
        model: string;
        d: string;
        bucket: number | string;
        w: number | string;
        l: number | string;
        net: number | string | null;
      }>(
        `SELECT model,
                to_char((requested_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS d,
                (EXTRACT(HOUR FROM requested_at AT TIME ZONE 'Asia/Bangkok')::int / 3)   AS bucket,
                COUNT(*) FILTER (WHERE result IN ('win', 'half-win'))   AS w,
                COUNT(*) FILTER (WHERE result IN ('lose', 'half-lose')) AS l,
                COALESCE(SUM(cash_pnl) FILTER (WHERE result IS NOT NULL), 0) AS net
           FROM gs_hcap_paper
          WHERE status = 'paper_signal' AND result IS NOT NULL AND model = ANY($1)
          GROUP BY 1, 2, 3`,
        [[...hcapKeyToRk.keys()]],
      );
      for (const r of hcapRes.rows) {
        const rk = hcapKeyToRk.get(r.model);
        if (rk) aggRows.push({ rk, d: r.d, bucket: num(r.bucket), w: num(r.w), l: num(r.l), net: num(r.net) });
      }
    }

    // Last-activity per bot (unfiltered by settlement — an open/unsettled leg still counts as
    // "còn chạy"). Powers the "ẩn model đã ngừng chạy" toggle in BotReport. Keyed by render calcVersion.
    const lastActiveMap = new Map<string, Date>();
    if (txKeyToRk.size > 0) {
      const lastTxRes = await pool.query<{ calc_version: string; last_at: Date }>(
        `SELECT calc_version, MAX(entry_at) AS last_at
           FROM gs_tx_paper
          WHERE calc_version = ANY($1)
          GROUP BY 1`,
        [[...txKeyToRk.keys()]],
      );
      for (const r of lastTxRes.rows) {
        const rk = txKeyToRk.get(r.calc_version);
        if (rk && r.last_at) lastActiveMap.set(rk, new Date(r.last_at));
      }
    }
    if (hcapKeyToRk.size > 0) {
      const lastHcapRes = await pool.query<{ model: string; last_at: Date }>(
        `SELECT model, MAX(requested_at) AS last_at
           FROM gs_hcap_paper
          WHERE model = ANY($1)
          GROUP BY 1`,
        [[...hcapKeyToRk.keys()]],
      );
      for (const r of lastHcapRes.rows) {
        const rk = hcapKeyToRk.get(r.model);
        if (rk && r.last_at) lastActiveMap.set(rk, new Date(r.last_at));
      }
    }
    const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Distinct days (ascending) across ALL bots — shared column axis.
    const daySet = new Set<string>();
    for (const r of aggRows) daySet.add(r.d);
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
    for (const r of aggRows) {
      const buckets = agg.get(r.rk);
      if (!buckets) continue;
      const bi = r.bucket;
      const di = dayIdx.get(r.d);
      if (bi < 0 || bi >= BUCKET_COUNT || di == null) continue;
      buckets[bi][di] = { w: r.w, l: r.l, net: r.net };
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

      const lastActive = lastActiveMap.get(b.calcVersion) ?? null;
      const stale = lastActive == null || now - lastActive.getTime() > STALE_MS;

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
        lastActiveAt: lastActive ? lastActive.toISOString() : null,
        stale,
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
