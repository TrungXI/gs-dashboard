'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AsianResult,
  GsReportResponse,
  GsReportRow,
  GsReportSummary,
  GsReportTrend,
} from '../app/api/gs-report/route';
import type { GsPaperResponse, GsPaperRow, GsPaperSummary } from '../app/api/gs-paper/route';
import { LoadingState, Spinner } from './Spinner';
import MatchDetailDrawer from './MatchDetailDrawer';

// ── Result badge config ───────────────────────────────────────────────────────

const RESULT_META: Record<AsianResult, { label: string; cls: string }> = {
  win: { label: 'ĂN', cls: 'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#4ade80]' },
  'half-win': { label: 'ĂN NỬA', cls: 'bg-[#84cc16]/15 border-[#84cc16]/40 text-[#bef264]' },
  push: { label: 'HÒA', cls: 'bg-white/[.06] border-white/15 text-[#aaa]' },
  'half-loss': { label: 'THUA NỬA', cls: 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#fbbf24]' },
  loss: { label: 'THUA', cls: 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#f87171]' },
  skip: { label: 'BỎ', cls: 'bg-white/[.03] border-white/10 text-[#666]' },
  pending: { label: '⏳ chờ', cls: 'bg-[#a78bfa]/10 border-[#a78bfa]/30 text-[#a78bfa]' },
};

function ResultBadge({ result }: { result: AsianResult }) {
  const m = RESULT_META[result];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ── Confidence badge (độ tin kèo: Cao/TB/Thấp) ────────────────────────────────
const CONF_META: Record<string, { label: string; cls: string }> = {
  Cao: { label: 'CAO', cls: 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#f87171]' },
  TB: { label: 'TB', cls: 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#fbbf24]' },
  'Thấp': { label: 'THẤP', cls: 'bg-white/[.06] border-white/15 text-[#9aa]' },
};
function ConfBadge({ conf }: { conf: string }) {
  const m = CONF_META[conf] ?? { label: conf, cls: 'bg-white/[.06] border-white/15 text-[#888]' };
  return (
    <span
      className={`ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold border align-middle ${m.cls}`}
      title={`Độ tin: ${conf}`}
    >
      {m.label}
    </span>
  );
}

// ── Verdict reason parsing (mirrors GSLive KeoPanel) ──────────────────────────

function parseVerdictReasons(verdict: string | null): { hc: string | null; ou: string | null } {
  if (!verdict) return { hc: null, ou: null };
  const grab = (tag: string): string | null => {
    const re = new RegExp(`\\[${tag}\\][^:\\n]*::\\s*([^\\n]+)`);
    const m = verdict.match(re);
    return m ? m[1].trim() : null;
  };
  return { hc: grab('HC'), ou: grab('OU') };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseScore(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/** FT winner: 'home' | 'away' | 'draw' | null. */
function ftWinner(ft: string | null): 'home' | 'away' | 'draw' | null {
  const s = parseScore(ft);
  if (!s) return null;
  if (s[0] > s[1]) return 'home';
  if (s[1] > s[0]) return 'away';
  return 'draw';
}

function pct(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

// ── Filters ───────────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'settled' | 'win' | 'loss' | 'skip' | 'paper';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'settled', label: 'Đã chấm' },
  { key: 'win', label: 'Ăn' },
  { key: 'loss', label: 'Thua' },
  { key: 'skip', label: 'BỎ' },
  { key: 'paper', label: '🧪 Kèo bóng' },
];

const PAGE_SIZE = 50;

// ── Paper (shadow) result badge — hit: true=Ăn, false=Thua, null=Hòa/⏳ ────────
function PaperResultBadge({ hit, hasFt }: { hit: boolean | null; hasFt: boolean }) {
  let label: string;
  let cls: string;
  if (hit === true) {
    label = 'ĂN';
    cls = 'bg-[#22c55e]/15 border-[#22c55e]/40 text-[#4ade80]';
  } else if (hit === false) {
    label = 'THUA';
    cls = 'bg-[#ef4444]/15 border-[#ef4444]/40 text-[#f87171]';
  } else if (hasFt) {
    label = 'HÒA';
    cls = 'bg-white/[.06] border-white/15 text-[#aaa]';
  } else {
    label = '⏳ chờ';
    cls = 'bg-[#a78bfa]/10 border-[#a78bfa]/30 text-[#a78bfa]';
  }
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border ${cls}`}>
      {label}
    </span>
  );
}

/** Paper leg label: HC → Chấp, OU → Tài/Xỉu. */
function paperLegLabel(leg: string): string {
  if (leg === 'HC') return 'Chấp';
  if (leg === 'OU') return 'Tài/Xỉu';
  return leg;
}

// ── Trend arrow ───────────────────────────────────────────────────────────────

function TrendArrow({ direction }: { direction: 'up' | 'down' | 'flat' | null }) {
  if (direction === 'up') return <span className="text-[#4ade80]">↑</span>;
  if (direction === 'down') return <span className="text-[#f87171]">↓</span>;
  if (direction === 'flat') return <span className="text-[#888]">→</span>;
  return <span className="text-[#555]">—</span>;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums text-white leading-none">{value}</div>
      {sub != null && <div className="mt-1 text-[11px] text-[#888]">{sub}</div>}
    </div>
  );
}

// ── Paper (shadow) section ─────────────────────────────────────────────────────
// Visually distinct "PAPER, not real money" block — its OWN compact summary +
// list, completely separate from the real header cards above.

function PaperSection({
  loading,
  error,
  rows,
  summary,
  onOpenDetail,
}: {
  loading: boolean;
  error: string | null;
  rows: GsPaperRow[];
  summary: GsPaperSummary | null;
  onOpenDetail: (d: { eventId: number; home: string; away: string }) => void;
}) {
  if (loading && summary === null) {
    return <LoadingState label="Đang tải kèo bóng…" className="py-16" />;
  }
  if (error !== null) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-[#3a3a3a] bg-[#141414] py-16 text-[13px] text-[#666]">
        Lỗi tải kèo bóng: {error}
      </div>
    );
  }
  if (summary === null || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#3a3a3a] bg-[#141414] py-16 text-center">
        <div className="text-[13px] text-[#888]">Chưa có kèo bóng nào</div>
        <div className="text-[11px] text-[#555]">
          Kèo bóng là kèo engine WOULD-have ra ở gate suýt-đạt — theo dõi để học, không cược.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Compact paper-only summary — dashed amber accent, clearly not the real header */}
      <div className="rounded-lg border border-dashed border-[#f59e0b]/40 bg-[#f59e0b]/[.05] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-snug">
          <span className="rounded bg-[#f59e0b]/15 border border-[#f59e0b]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#fbbf24]">
            🧪 CHƯA CƯỢC
          </span>
          <span className="font-bold text-[#fbbf24]">Kèo bóng:</span>
          <span className="tabular-nums text-[#ddd]">{summary.total} tổng</span>
          <span className="text-[#555]">·</span>
          <span className="tabular-nums text-[#4ade80]">{summary.win} ăn</span>
          <span className="text-[#555]">/</span>
          <span className="tabular-nums text-[#f87171]">{summary.loss} thua</span>
          <span className="text-[#555]">·</span>
          <span className="tabular-nums text-[#ddd]">hit {pct(summary.winRate)}</span>
          <span className="text-[#555]">·</span>
          <span className="tabular-nums text-[#999]">
            (chấp {summary.hcWin}/{summary.hcSettled} · T/X {summary.ouWin}/{summary.ouSettled})
          </span>
          {(summary.push > 0 || summary.pending > 0) && (
            <>
              <span className="text-[#555]">·</span>
              <span className="tabular-nums text-[#888]">
                {summary.push} hòa · {summary.pending} chờ
              </span>
            </>
          )}
        </div>
      </div>

      {/* Paper list — dashed muted rows so it reads as "paper, not real money" */}
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const winner = ftWinner(row.ft_score);
          const hasFt = parseScore(row.ft_score) !== null;
          return (
            <div
              key={`${row.event_id}-${row.leg}-${i}`}
              className="rounded-lg border border-dashed border-[#3a3a3a] bg-[#121212] p-3 opacity-90"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13px] leading-snug">
                  <span className="mr-1.5 rounded bg-[#f59e0b]/15 border border-[#f59e0b]/40 px-1 py-0.5 text-[9px] font-bold text-[#fbbf24] align-middle">
                    🧪
                  </span>
                  <span className={winner === 'home' ? 'font-bold text-[#4ade80]' : 'text-[#ccc]'}>
                    {row.home_team ?? '?'}
                  </span>
                  <span className="text-[#555]"> vs </span>
                  <span className={winner === 'away' ? 'font-bold text-[#4ade80]' : 'text-[#ccc]'}>
                    {row.away_team ?? '?'}
                  </span>
                </div>
                <PaperResultBadge hit={row.hit} hasFt={hasFt} />
              </div>

              {/* Score line */}
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] tabular-nums text-[#999]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#555]">HT</span>
                <span>{row.ht_score ?? '—'}</span>
                <span className="text-[#444]">→</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#555]">FT</span>
                <span className="font-semibold text-[#ccc]">{row.ft_score ?? '—'}</span>
              </div>

              {/* Leg + pick + rule */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] font-bold uppercase text-[#555]">{paperLegLabel(row.leg)}</span>
                <span className="rounded bg-white/[.04] border border-dashed border-[#4a4a4a] px-1.5 py-0.5 text-[11px] font-semibold text-[#bbb]">
                  {row.pick ?? '—'}
                </span>
                {row.rule && (
                  <span className="rounded bg-[#a78bfa]/10 border border-[#a78bfa]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a78bfa]">
                    {row.rule}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onOpenDetail({
                      eventId: row.event_id,
                      home: row.home_team ?? '?',
                      away: row.away_team ?? '?',
                    })
                  }
                  className="ml-auto text-[11px] font-semibold text-[#5fd0e0] hover:text-[#8ee3f0] transition-colors"
                >
                  📋 Chi tiết trận
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function BetStatsView({ initialMatch }: { initialMatch?: number | null } = {}) {
  const [rows, setRows] = useState<GsReportRow[]>([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [summary, setSummary] = useState<GsReportSummary | null>(null);
  const [trend, setTrend] = useState<GsReportTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // initial / filter-change load
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  // Paper (shadow) picks — SEPARATE dataset, only fetched on the 🧪 chip. Never
  // mixed into the real header summary/trend above.
  const [paperRows, setPaperRows] = useState<GsPaperRow[]>([]);
  const [paperSummary, setPaperSummary] = useState<GsPaperSummary | null>(null);
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  // Drawer "chi tiết trận" — trận đang mở (null = đóng).
  const [detail, setDetail] = useState<{ eventId: number; home: string; away: string } | null>(null);

  // Guards against a stale response overwriting a newer filter selection.
  const reqRef = useRef(0);

  const load = useCallback(async (f: FilterKey, offset: number) => {
    const reqId = ++reqRef.current;
    const append = offset > 0;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(
        `/api/gs-report?filter=${f}&limit=${PAGE_SIZE}&offset=${offset}`,
        { cache: 'no-store' },
      );
      const json: GsReportResponse = await res.json();
      if (reqId !== reqRef.current) return; // superseded by a newer request
      if (!json.ok) {
        setError(json.error || 'Không tải được dữ liệu');
        return;
      }
      setSummary(json.summary ?? null);
      setTrend(json.trend ?? null);
      setRowsTotal(json.rowsTotal ?? 0);
      setRows((prev) => (append ? [...prev, ...(json.rows ?? [])] : json.rows ?? []));
    } catch (e) {
      if (reqId === reqRef.current) setError(String(e));
    } finally {
      if (reqId === reqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Paper picks live in a separate route with their own summary. Fetched once
  // per activation of the 🧪 chip (kept out of the real header entirely).
  const paperReqRef = useRef(0);
  const loadPaper = useCallback(async () => {
    const reqId = ++paperReqRef.current;
    setPaperLoading(true);
    setPaperError(null);
    try {
      const res = await fetch('/api/gs-paper', { cache: 'no-store' });
      const json: GsPaperResponse = await res.json();
      if (reqId !== paperReqRef.current) return;
      if (!json.ok) {
        setPaperError(json.error || 'Không tải được kèo bóng');
        return;
      }
      setPaperRows(json.rows ?? []);
      setPaperSummary(json.summary ?? null);
    } catch (e) {
      if (reqId === paperReqRef.current) setPaperError(String(e));
    } finally {
      if (reqId === paperReqRef.current) setPaperLoading(false);
    }
  }, []);

  // Fetch page 0 on mount + whenever the filter changes. On the paper chip we
  // fetch the paper route instead — the real report list is not refetched, and
  // the already-loaded real summary/trend stays untouched.
  useEffect(() => {
    if (filter === 'paper') {
      loadPaper();
    } else {
      load(filter, 0);
    }
  }, [filter, load, loadPaper]);

  // Deep-link: auto-open the detail drawer for `initialMatch` once on mount.
  // home/away come from the current rows if present, else from a minimal
  // gs-bets fetch (the row may not be on the loaded page). The drawer itself
  // fetches full stats by eventId, so a fallback header is enough.
  // Guard by eventId (survives StrictMode double-invoke in dev) so we open
  // exactly once and never fight a manual close.
  const deepLinkOpenedFor = useRef<number | null>(null);
  useEffect(() => {
    if (initialMatch == null || !Number.isFinite(initialMatch)) return;
    if (deepLinkOpenedFor.current === initialMatch) return;
    deepLinkOpenedFor.current = initialMatch;

    const fromRow = rows.find((r) => r.event_id === initialMatch);
    if (fromRow) {
      setDetail({
        eventId: initialMatch,
        home: fromRow.home_team ?? '?',
        away: fromRow.away_team ?? '?',
      });
      return;
    }
    // Row not on this page — fetch minimal home/away. Let it complete even if
    // the effect is torn down/re-run (StrictMode); the guard prevents dupes.
    fetch(`/api/gs-bets?eventId=${initialMatch}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; pick?: { home_team?: string | null; away_team?: string | null } | null }) => {
        setDetail({
          eventId: initialMatch,
          home: json.ok ? json.pick?.home_team ?? '?' : '?',
          away: json.ok ? json.pick?.away_team ?? '?' : '?',
        });
      })
      .catch(() => {
        setDetail({ eventId: initialMatch, home: '?', away: '?' });
      });
  }, [initialMatch, rows]);

  const selectFilter = (key: FilterKey) => {
    if (key === filter) return;
    setFilter(key);
  };

  const loadMore = () => load(filter, rows.length);

  // ── Full-page loading CHỈ khi tải LẦN ĐẦU (chưa có summary). Đổi filter → chỉ loading phần list ──
  if (loading && summary === null) {
    return (
      <>
        <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>
        <LoadingState label="Đang tải…" className="py-24" />
      </>
    );
  }

  // ── Error ──
  if (error !== null) {
    return (
      <>
        <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>
        <div className="flex items-center justify-center py-24 text-[13px] text-[#666]">
          Lỗi tải dữ liệu: {error}
        </div>
      </>
    );
  }

  if (summary === null || trend === null) return null;

  // ── Truly-empty dataset (no v2-era bets yet) — v2 vừa lên nên có thể ZERO kèo ──
  // On the 🧪 paper chip we still render (paper picks are a separate dataset).
  if (summary.total === 0 && filter !== 'paper') {
    return (
      <>
        <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>
        <div className="flex flex-col items-center justify-center gap-1.5 py-24 text-center">
          <div className="text-[13px] text-[#888]">Chưa có kèo nào từ khi cơ chế 2 lên</div>
          <div className="text-[11px] text-[#555]">
            Thống kê chỉ tính kèo ra từ mốc cơ chế v2 (19/07 12:27) trở đi.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-4 text-[18px] font-extrabold">📊 Thống kê kèo</h1>

      {/* Real header cards — REAL picks only (gs_ht_analysis, TB/Cao). Hidden on the
          🧪 paper chip so paper numbers never appear alongside real ones. */}
      {filter !== 'paper' && (
      <>
      {/* Summary cards — header aggregate over ALL v2-era kèo (kể cả BỎ) */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Card
          label="Tổng kèo v2"
          value={summary.bets}
          sub={`${summary.actionable} trận vào kèo · ${summary.pending} chờ`}
        />
        <Card
          label="Ăn kèo chấp"
          value={pct(summary.side.winRate)}
          sub={`${summary.side.settled} kèo đã chấm`}
        />
        <Card
          label="Ăn Tài/Xỉu"
          value={pct(summary.ou.winRate)}
          sub={`${summary.ou.settled} kèo đã chấm`}
        />
        <Card
          label="ROI"
          value={
            summary.roi == null ? (
              '—'
            ) : (
              <span className={summary.roi >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>
                {summary.roi >= 0 ? '+' : ''}
                {(summary.roi * 100).toFixed(1)}%
              </span>
            )
          }
          sub="lãi/lỗ mỗi kèo"
        />
        <Card
          label="Trọng tài AI đúng"
          value={
            summary.referee.accuracy == null ? (
              '—'
            ) : (
              <span
                className={
                  summary.referee.accuracy >= 0.5 ? 'text-[#4ade80]' : 'text-[#f87171]'
                }
              >
                {pct(summary.referee.accuracy)}
              </span>
            )
          }
          sub={
            summary.referee.audited === 0
              ? 'chưa chấm (chỉ soi kèo TB/Cao)'
              : `${summary.referee.correct} đúng / ${summary.referee.wrong} sai · ${summary.referee.audited} kèo TB/Cao`
          }
        />
        <Card
          label="Ăn nửa / Thua nửa"
          value={
            <span>
              <span className="text-[#bef264]">{summary.halfWin}</span>
              <span className="text-[#555]"> / </span>
              <span className="text-[#fbbf24]">{summary.halfLoss}</span>
            </span>
          }
        />
        <Card label="Trận bỏ (0 kèo)" value={summary.skipped} />
        <Card
          label="Xu hướng (20 gần)"
          value={
            <span className="inline-flex items-center gap-1.5">
              <TrendArrow direction={trend.direction} />
              <span>{pct(trend.last)}</span>
            </span>
          }
          sub={`trước: ${pct(trend.prev)}`}
        />
      </div>
      </>
      )}

      {/* Filter chips */}
      <div className="mb-3 flex flex-wrap gap-1.5 max-md:sticky max-md:top-0 max-md:z-30 max-md:-mx-3 max-md:px-3 max-md:py-2 max-md:bg-[#0d0d0d]/95 max-md:backdrop-blur max-md:border-b max-md:border-[#2a2a2a]">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => selectFilter(key)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
              filter === key
                ? 'bg-[#17a2b8] text-white'
                : 'bg-white/[.06] text-white/60 hover:bg-white/[.12] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-[#666]">
          {filter === 'paper' ? `${paperSummary?.total ?? 0} kèo bóng` : `${rowsTotal} trận`}
        </span>
      </div>

      {filter === 'paper' ? (
        <PaperSection
          loading={paperLoading}
          error={paperError}
          rows={paperRows}
          summary={paperSummary}
          onOpenDetail={setDetail}
        />
      ) : loading ? (
        <LoadingState label="Đang lọc…" className="py-16" />
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] py-16 text-[13px] text-[#666]">
          Không có kèo nào cho bộ lọc &quot;{FILTERS.find((f) => f.key === filter)?.label ?? filter}&quot;
        </div>
      ) : (
      <>
      {/* Table (desktop only) */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <div className="min-w-[900px]">
          {/* Header */}
          <div className="grid grid-cols-[92px_minmax(180px,1.4fr)_88px_88px_minmax(150px,1fr)_150px_minmax(240px,1.6fr)] items-center gap-2 border-b border-[#222] bg-[#111] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#666]">
            <div>Thời điểm</div>
            <div>Trận</div>
            <div className="text-center">Tỉ số ra kèo</div>
            <div className="text-center">Tỉ số cuối</div>
            <div>Kèo</div>
            <div>Kết quả</div>
            <div>Lý do &amp; đúc kết</div>
          </div>

          {/* Rows */}
          {rows.map((row) => {
            const winner = ftWinner(row.ft_score);
            const { hc, ou } = parseVerdictReasons(row.verdict);
            const hasParsed = hc || ou;
            return (
              <div
                key={row.event_id}
                className="grid grid-cols-[92px_minmax(180px,1.4fr)_88px_88px_minmax(150px,1fr)_150px_minmax(240px,1.6fr)] items-start gap-2 border-b border-[#1a1a1a]/70 px-3 py-2.5 text-[12px] last:border-0 hover:bg-white/[.02]"
              >
                {/* Thời điểm */}
                <div className="tabular-nums text-[#999]">{fmtTime(row.created_at)}</div>

                {/* Trận */}
                <div className="leading-snug">
                  <span className={winner === 'home' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.home_team ?? '?'}
                  </span>
                  <span className="text-[#555]"> vs </span>
                  <span className={winner === 'away' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.away_team ?? '?'}
                  </span>
                  {row.confidence && <ConfBadge conf={row.confidence} />}
                  <button
                    type="button"
                    onClick={() =>
                      setDetail({
                        eventId: row.event_id,
                        home: row.home_team ?? '?',
                        away: row.away_team ?? '?',
                      })
                    }
                    className="mt-1 block text-[10px] font-semibold text-[#5fd0e0] hover:text-[#8ee3f0] transition-colors"
                  >
                    📋 Chi tiết trận
                  </button>
                </div>

                {/* Tỉ số ra kèo */}
                <div className="text-center tabular-nums text-[#bbb]">{row.ht_score ?? '—'}</div>

                {/* Tỉ số cuối */}
                <div className="text-center tabular-nums font-semibold text-[#ddd]">{row.ft_score ?? '—'}</div>

                {/* Kèo */}
                <div className="flex flex-col gap-1">
                  {row.side_pick && (
                    <span className="w-fit rounded bg-[#f59e0b]/15 border border-[#f59e0b]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#fbbf24]">
                      {row.side_pick}
                    </span>
                  )}
                  {row.ou_pick && (
                    <span className="w-fit rounded bg-[#17a2b8]/15 border border-[#17a2b8]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#5fd0e0]">
                      {row.ou_pick}
                    </span>
                  )}
                  {!row.side_pick && !row.ou_pick && <span className="text-[#555]">—</span>}
                </div>

                {/* Kết quả */}
                <div className="flex flex-col gap-1">
                  {row.side_pick && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555]">HC</span>
                      <ResultBadge result={row.side_result} />
                    </div>
                  )}
                  {row.ou_pick && (
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555]">T/X</span>
                      <ResultBadge result={row.ou_result} />
                    </div>
                  )}
                  {!row.side_pick && !row.ou_pick && <ResultBadge result="skip" />}
                </div>

                {/* Lý do & đúc kết */}
                <div className="flex flex-col gap-1 leading-snug text-[11px]">
                  {(row.side_pick || hc) && (
                    <div>
                      <span className="font-semibold text-[#666]">Chấp: </span>
                      {hc ? <span className="text-[#ccc]">{hc}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {(row.ou_pick || ou) && (
                    <div>
                      <span className="font-semibold text-[#666]">Tài/Xỉu: </span>
                      {ou ? <span className="text-[#ccc]">{ou}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {!hasParsed && row.verdict && (
                    <div className="text-[#bbb]">{row.verdict}</div>
                  )}
                  {row.review_note && (
                    <div className="mt-0.5 border-l-2 border-[#a78bfa]/40 pl-1.5 text-[#a78bfa]">
                      <span className="font-semibold text-[#8b6fd4]">Đúc kết: </span>
                      {row.review_note}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cards (mobile only) */}
      <div className="md:hidden flex flex-col gap-2.5">
        {rows.map((row) => {
          const winner = ftWinner(row.ft_score);
          const { hc, ou } = parseVerdictReasons(row.verdict);
          const hasParsed = hc || ou;
          const noPick = !row.side_pick && !row.ou_pick;
          return (
            <div
              key={row.event_id}
              className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-3"
            >
              {/* Top row: teams + time */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 text-[13px] leading-snug">
                  <span className={winner === 'home' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.home_team ?? '?'}
                  </span>
                  <span className="text-[#555]"> vs </span>
                  <span className={winner === 'away' ? 'font-bold text-[#4ade80]' : 'text-[#ddd]'}>
                    {row.away_team ?? '?'}
                  </span>
                  {row.confidence && <ConfBadge conf={row.confidence} />}
                  <button
                    type="button"
                    onClick={() =>
                      setDetail({
                        eventId: row.event_id,
                        home: row.home_team ?? '?',
                        away: row.away_team ?? '?',
                      })
                    }
                    className="mt-1 block text-[11px] font-semibold text-[#5fd0e0] hover:text-[#8ee3f0] transition-colors"
                  >
                    📋 Chi tiết trận
                  </button>
                </div>
                <span className="shrink-0 tabular-nums text-[11px] text-[#999]">{fmtTime(row.created_at)}</span>
              </div>

              {/* Score line */}
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] tabular-nums text-[#bbb]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#666]">HT</span>
                <span>{row.ht_score ?? '—'}</span>
                <span className="text-[#555]">→</span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#666]">FT</span>
                <span className="font-semibold text-[#ddd]">{row.ft_score ?? '—'}</span>
              </div>

              {/* Picks + results */}
              <div className="mt-2.5 flex flex-col gap-1.5">
                {row.side_pick && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase text-[#555]">Chấp</span>
                    <span className="rounded bg-[#f59e0b]/15 border border-[#f59e0b]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#fbbf24]">
                      {row.side_pick}
                    </span>
                    <ResultBadge result={row.side_result} />
                  </div>
                )}
                {row.ou_pick && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase text-[#555]">T/X</span>
                    <span className="rounded bg-[#17a2b8]/15 border border-[#17a2b8]/40 px-1.5 py-0.5 text-[11px] font-bold text-[#5fd0e0]">
                      {row.ou_pick}
                    </span>
                    <ResultBadge result={row.ou_result} />
                  </div>
                )}
                {noPick && <ResultBadge result="skip" />}
              </div>

              {/* Reasons + review note */}
              {(row.side_pick || hc || row.ou_pick || ou || (!hasParsed && row.verdict) || row.review_note) && (
                <div className="mt-2.5 flex flex-col gap-1 border-t border-[#222] pt-2.5 text-[11px] leading-snug">
                  {(row.side_pick || hc) && (
                    <div>
                      <span className="font-semibold text-[#666]">Chấp: </span>
                      {hc ? <span className="text-[#ccc]">{hc}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {(row.ou_pick || ou) && (
                    <div>
                      <span className="font-semibold text-[#666]">Tài/Xỉu: </span>
                      {ou ? <span className="text-[#ccc]">{ou}</span> : <span className="text-[#555]">—</span>}
                    </div>
                  )}
                  {!hasParsed && row.verdict && <div className="text-[#bbb]">{row.verdict}</div>}
                  {row.review_note && (
                    <div className="mt-0.5 border-l-2 border-[#a78bfa]/40 pl-1.5 text-[#a78bfa]">
                      <span className="font-semibold text-[#8b6fd4]">📝 Đúc kết: </span>
                      {row.review_note}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {rows.length < rowsTotal && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-[12px] font-semibold text-white/80 transition-colors hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore && <Spinner size={14} />}
            {loadingMore ? 'Đang tải…' : `Xem thêm (${rows.length}/${rowsTotal})`}
          </button>
        </div>
      )}
      </>
      )}

      {detail && (
        <MatchDetailDrawer
          eventId={detail.eventId}
          home={detail.home}
          away={detail.away}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
