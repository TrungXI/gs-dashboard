'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import TxTimelineChart from './TxTimelineChart';
import TxDetailDrawer from './TxDetailDrawer';
import TxRuleModal from './TxRuleModal';
import { getTxRule } from '../lib/txRules';

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

const AUTO_MS = 5000; // tự động refresh 5s cố định (không cho tắt/đổi)

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
  const [detailVersion, setDetailVersion] = useState<string | null>(null); // version đang mở drawer chi tiết
  const [ruleVersion, setRuleVersion] = useState<string | null>(null); // version đang mở modal Xem Rule

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

  // Initial load — khôi phục version đã xem trước đó (localStorage) → F5 không mất context.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('tx-selected-version') : null;
    load(saved || '', 0);
  }, [load]);

  // Auto-refresh — LUÔN 5s, silent (không bật spinner, lỗi tạm giữ nguyên bảng cũ).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(buildQuery(selected, page), { cache: 'no-store' });
        const json = (await res.json()) as TxReportResponse & { error?: string };
        if (!cancelled && json.ok) setData(json);
      } catch {
        /* giữ data cũ */
      }
      if (cancelled) return;
      timer = setTimeout(tick, AUTO_MS);
    };
    timer = setTimeout(tick, AUTO_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, page]);

  const onSelect = (v: string) => {
    setSelected(v);
    setPage(0);
    try { localStorage.setItem('tx-selected-version', v); } catch { /* noop */ } // nhớ bot đang xem qua F5
    load(v, 0); // đổi version → về trang đầu
  };

  const summary = data?.summaryByVersion ?? [];

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden">
      {/* Header + version selector */}
      <div className="mb-5 flex shrink-0 items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">💰 Báo cáo Tài/Xỉu (paper)</h1>
        <span className="text-[11px] text-[#666]">⟳ tự cập nhật 5s</span>
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
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-4 lg:grid-cols-[320px_1fr] lg:grid-rows-1 lg:items-stretch">
            {/* List version — mobile: dưới chart, lấp phần còn lại & cuộn; desktop: cột trái full-height & cuộn */}
            <div className="order-2 flex min-h-0 min-w-0 flex-col lg:order-none lg:col-start-1 lg:row-start-1">
              <div className="mb-2 shrink-0 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">So sánh version</div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {(() => {
                  // Nhóm 1 (pin đầu): 4 con TIỀN THẬT, sort theo PnL. Nhóm 2 (dưới): còn lại, sort theo PnL.
                  const RM = ['V.Bot 12 Real', 'V.Bot 12 Kien', 'V.Bot 12 Trong', 'V.Bot 12 Nam'];
                  const isRM = (v: string) => RM.includes(v);
                  const sorted = [...summary].sort((a, b) => {
                    const ra = isRM(a.calcVersion), rb = isRM(b.calcVersion);
                    if (ra !== rb) return ra ? -1 : 1;           // real money luôn lên trên
                    return b.withNhoi.pnl - a.withNhoi.pnl;       // cùng nhóm → PnL giảm dần
                  });
                  const firstOther = sorted.findIndex((s) => !isRM(s.calcVersion));
                  return sorted.map((s, idx) => {
                  const showDivider = idx === firstOther && firstOther > 0;
                  const active = s.calcVersion === selected;
                  return (
                    <Fragment key={s.calcVersion}>
                      {showDivider && (
                        <div className="mb-0.5 mt-2 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[#666]">
                          <span className="h-px flex-1 bg-[#2a2a2a]" />Các bot khác<span className="h-px flex-1 bg-[#2a2a2a]" />
                        </div>
                      )}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(s.calcVersion)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.calcVersion); } }}
                      title="Bấm để xem chart của version này"
                      className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition ${s.openBets > 0 ? 'tx-pending ' : ''}${active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/10' : 'border-[#2a2a2a] bg-[#141414] hover:bg-white/[.05]'}`}
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
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#38bdf8]/45 bg-[#38bdf8]/15 px-2 py-1 text-[12px] font-semibold leading-none text-[#7dd3fc] shadow-sm transition hover:bg-[#38bdf8]/30 hover:text-white active:scale-95"
                          >
                            📋 Chi tiết
                          </button>
                        </div>
                      </div>
                      {/* Nút Xem Rule — ngay dưới Chi tiết, mở modal rule của CHÍNH bot này */}
                      <div className="mt-1.5 flex justify-end">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setRuleVersion(s.calcVersion); }}
                          title="Xem rule / chiến lược bot này đang chạy"
                          aria-label="Xem rule bot"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#fbbf24]/45 bg-[#fbbf24]/15 px-2 py-1 text-[12px] font-semibold leading-none text-[#fcd34d] shadow-sm transition hover:bg-[#fbbf24]/30 hover:text-white active:scale-95"
                        >
                          📖 Xem Rule
                        </button>
                      </div>
                      {/* Note rule INLINE (ngoài modal) — chỉ hiện cho bot có tóm tắt `short` (2 con tiền thật). */}
                      {getTxRule(s.calcVersion).short && (
                        <div className="mt-1 rounded-md border border-[#fbbf24]/25 bg-[#fbbf24]/[.06] px-2 py-1 text-[11px] leading-snug text-[#d4b483]">
                          {getTxRule(s.calcVersion).short}
                        </div>
                      )}
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
                    </Fragment>
                  );
                });
                })()}
              </div>
            </div>

            {/* Biểu đồ — mobile: trên cùng cao 320px; desktop: cột phải full chiều cao */}
            <div className="order-1 h-full min-h-0 min-w-0 overflow-hidden lg:order-none lg:col-start-2 lg:row-start-1 lg:h-auto">
              <TxTimelineChart version={selected} />
            </div>
          </div>
        </>
      )}

      {/* Drawer chi tiết kèo — mở khi bấm version, có nút "Tải thêm" */}
      {detailVersion && <TxDetailDrawer version={detailVersion} onClose={() => setDetailVersion(null)} />}

      {/* Modal Xem Rule — rule/chiến lược của bot đang chọn */}
      {ruleVersion && <TxRuleModal version={ruleVersion} onClose={() => setRuleVersion(null)} />}
    </div>
  );
}
