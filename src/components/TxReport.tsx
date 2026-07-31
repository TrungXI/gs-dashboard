'use client';

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import TxTimelineChart from './TxTimelineChart';
import TxDetailDrawer from './TxDetailDrawer';

// ── Response shape (mirror /api/gs-tx-report — SPEC §3.2) ───────────────────
interface TxReportRow {
  id: number; calcVersion: string;
  entryAt: string;          // ISO
  eventId: number; homeTeam: string; awayTeam: string;
  market: 'h1' | 'ft'; side: 'tai' | 'xiu';
  line: number; lineRaw: string | null; price: number; pModel: number; edge: number | null;
  kind: 'primary' | 'nhoi'; prevLine: number | null;
  scoredAtEntry: number; scoreHomeAtEntry: number | null; scoreAwayAtEntry: number | null; finalTotal: number | null;
  result: 'win' | 'half-win' | 'lose' | 'half-lose' | 'push' | null; pnl: number | null;
}
interface TxAggLine { bets: number; win: number; halfWin: number; lose: number; halfLose: number; push: number; winRate: number | null; pnl: number; }
interface TxVersionAgg {
  calcVersion: string;
  primaryOnly: TxAggLine;   // kind='primary' only
  withNhoi: TxAggLine;      // primary + nhoi combined
  nhoiOnly: TxAggLine;      // kind='nhoi' only
  openBets: number;         // kèo pending vào <15' gần đây — đang thật sự vô kèo (mồ côi cũ không tính)
}
interface TxReportResponse {
  ok: boolean;
  versions: string[];              // all distinct calc_version, latest-first
  selectedVersion: string | 'all';
  rows: TxReportRow[];             // detail, entry_at DESC, 1 trang
  page: number;                    // 0-based
  pageSize: number;
  totalRows: number;               // tổng kèo (theo filter) → số trang
  summaryByVersion: TxVersionAgg[]; // GROUP BY calc_version — always ALL versions
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const winRatePct = (wr: number | null): string => (wr == null ? '—' : `${Math.round(wr * 100)}%`);
// W/L/P kèm nửa-ăn/nửa-thua (chỉ hiện ½ khi >0): "3+1½ / 2 / 0"
const wlp = (a: { win: number; halfWin: number; lose: number; halfLose: number; push: number }): string => {
  const w = a.halfWin ? `${a.win}+${a.halfWin}½` : `${a.win}`;
  const l = a.halfLose ? `${a.lose}+${a.halfLose}½` : `${a.lose}`;
  return `${w} / ${l} / ${a.push}`;
};
const pnlStr = (v: number): string => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const pnlColor = (v: number): string => (v > 0 ? '#4ade80' : v < 0 ? '#fb7185' : '#8a8a8a');

// Nhịp tự động refresh. 'auto' = mặc định, poll đều 5s lấy list mới nhất.
type RefreshMode = 'off' | '5' | '10' | '15' | 'auto';
const REFRESH_MODES: RefreshMode[] = ['off', '5', '10', '15', 'auto'];
const AUTO_MS = 5000; // 'auto' = 5s cố định
const refreshLabel = (m: RefreshMode): string =>
  m === 'off' ? '⏸ Tắt' : m === 'auto' ? '⟳ Tự động (5s)' : `⟳ ${m}s`;

// Chỉ lấy 20 kèo/trang (performance). version '' → server default = latest.
const buildQuery = (version: string, pageArg: number): string => {
  const p = new URLSearchParams();
  if (version) p.set('version', version);
  p.set('page', String(pageArg));
  return `/api/gs-tx-report?${p.toString()}`;
};

export default function TxReport() {
  const [selected, setSelected] = useState<string>('all'); // '' = latest (server default)
  const [page, setPage] = useState(0); // 0-based, trang bảng chi tiết
  const [data, setData] = useState<TxReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshMode, setRefreshMode] = useState<RefreshMode>('auto');
  const [detailVersion, setDetailVersion] = useState<string | null>(null); // version đang mở drawer chi tiết

  const load = useCallback(async (version: string, pageArg: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildQuery(version, pageArg), { cache: 'no-store' });
      const json = (await res.json()) as TxReportResponse & { error?: string };
      if (!json.ok) throw new Error(json.error || 'Lỗi tải báo cáo');
      setData(json);
      // Sync selector với version server thực resolve (latest → concrete) + trang server trả về.
      setSelected(json.selectedVersion);
      setPage(json.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load = latest (empty version), trang 0.
  useEffect(() => { load('', 0); }, [load]);

  // Khôi phục nhịp refresh đã lưu (đọc trong effect → tránh hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem('tx-refresh-mode');
    if (saved && (REFRESH_MODES as string[]).includes(saved)) setRefreshMode(saved as RefreshMode);
  }, []);
  const onRefreshMode = (v: RefreshMode) => {
    setRefreshMode(v);
    localStorage.setItem('tx-refresh-mode', v);
  };

  // Auto-refresh — silent (không bật spinner, lỗi tạm giữ nguyên bảng cũ).
  // Dùng setTimeout tự lên lịch: mode 'auto' tính delay từ chính data vừa fetch (còn ⏳ → nhanh).
  useEffect(() => {
    if (refreshMode === 'off') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const delay = refreshMode === 'auto' ? AUTO_MS : Number(refreshMode) * 1000;
    const tick = async () => {
      try {
        const res = await fetch(buildQuery(selected, page), { cache: 'no-store' });
        const json = (await res.json()) as TxReportResponse & { error?: string };
        if (!cancelled && json.ok) setData(json);
      } catch {
        /* giữ data cũ */
      }
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshMode, selected, page]);

  const onSelect = (v: string) => {
    setSelected(v);
    setPage(0);
    load(v, 0); // đổi version → về trang đầu
  };

  const versions = data?.versions ?? [];
  const summary = data?.summaryByVersion ?? [];

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden">
      {/* Header + version selector */}
      <div className="mb-5 flex shrink-0 items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">💰 Báo cáo Tài/Xỉu (paper)</h1>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
        >
          <option value="all" className="bg-[#111] text-white">Tất cả</option>
          {versions.map((v) => (
            <option key={v} value={v} className="bg-[#111] text-white">{v}</option>
          ))}
        </select>
        <select
          value={refreshMode}
          onChange={(e) => onRefreshMode(e.target.value as RefreshMode)}
          title="Nhịp tự cập nhật list. Tự động = 5s (mặc định). Tắt để đỡ băng thông."
          className="rounded-lg bg-white/[.07] px-3 py-2 text-xs text-white outline-none"
        >
          {REFRESH_MODES.map((m) => (
            <option key={m} value={m} className="bg-[#111] text-white">{refreshLabel(m)}</option>
          ))}
        </select>
        {loading && <Spinner size={14} />}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">
          {error}
        </div>
      )}

      {!error && !loading && summary.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">⏳</div>
          <div className="text-[14px] text-[#888]">Chưa có kèo nào</div>
        </div>
      ) : (
        <>
          {/* ── List version + biểu đồ — khoá chiều cao viewport, CHỈ list cuộn ── */}
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[320px_1fr] lg:grid-rows-1 lg:items-stretch">
            {/* List version — mobile: dưới chart, lấp phần còn lại & cuộn; desktop: cột trái full-height & cuộn */}
            <div className="order-2 flex min-h-0 min-w-0 flex-col lg:order-none lg:col-start-1 lg:row-start-1">
              <div className="mb-2 shrink-0 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">So sánh version</div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {[...summary].sort((a, b) => b.withNhoi.pnl - a.withNhoi.pnl).map((s) => {
                  const active = s.calcVersion === selected;
                  return (
                    <div
                      key={s.calcVersion}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(s.calcVersion)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.calcVersion); } }}
                      title="Bấm để xem chart của version này"
                      className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition ${active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10' : 'border-[#2a2a2a] bg-[#141414] hover:bg-white/[.05]'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold text-white">{s.calcVersion}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[13px] font-semibold tabular-nums" style={{ color: pnlColor(s.withNhoi.pnl) }}>
                            {pnlStr(s.withNhoi.pnl)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onSelect(s.calcVersion); setDetailVersion(s.calcVersion); }}
                            title="Xem chi tiết kèo (drawer)"
                            aria-label="Xem chi tiết kèo"
                            className="rounded-md border border-[#2a2a2a] bg-white/[.04] px-1.5 py-0.5 text-[12px] leading-none text-[#9ca3af] hover:bg-white/[.12] hover:text-white"
                          >
                            📋
                          </button>
                        </div>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#888] tabular-nums">
                        <span>{s.withNhoi.bets} kèo</span>
                        <span className="text-[#444]">·</span>
                        <span>WR {winRatePct(s.withNhoi.winRate)}</span>
                        <span className="text-[#444]">·</span>
                        <span>{wlp(s.withNhoi)}</span>
                        {s.openBets > 0 && (
                          <span className="ml-auto inline-flex items-center gap-1 text-[#4ade80]" title={`${s.openBets} kèo vừa vào <15'`}>
                            <span className="tx-open-dot" />vô kèo
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Biểu đồ — mobile: trên cùng; desktop: cột phải */}
            <div className="order-1 min-h-0 min-w-0 overflow-hidden lg:order-none lg:col-start-2 lg:row-start-1">
              <TxTimelineChart version={selected} />
            </div>
          </div>
        </>
      )}

      {/* Drawer chi tiết kèo — mở khi bấm version, có nút "Tải thêm" */}
      {detailVersion && <TxDetailDrawer version={detailVersion} onClose={() => setDetailVersion(null)} />}
    </div>
  );
}
