'use client';

import { useCallback, useEffect, useState } from 'react';
import { Spinner } from './Spinner';

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
  openBets: number;         // kèo chưa settle (result IS NULL) — đang vô kèo
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

// entryAt ISO → giờ VN (UTC+7) "HH:mm" (pattern +7h → getUTC*, như matchUtils.ts).
function vnTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min}`;
}

const winRatePct = (wr: number | null): string => (wr == null ? '—' : `${Math.round(wr * 100)}%`);
// W/L/P kèm nửa-ăn/nửa-thua (chỉ hiện ½ khi >0): "3+1½ / 2 / 0"
const wlp = (a: { win: number; halfWin: number; lose: number; halfLose: number; push: number }): string => {
  const w = a.halfWin ? `${a.win}+${a.halfWin}½` : `${a.win}`;
  const l = a.halfLose ? `${a.lose}+${a.halfLose}½` : `${a.lose}`;
  return `${w} / ${l} / ${a.push}`;
};
// Tỉ số home–away lúc vào kèo. Kèo cũ (trước khi bot lưu cột này) → "- -".
const entryScore = (r: { scoreHomeAtEntry: number | null; scoreAwayAtEntry: number | null }): string =>
  r.scoreHomeAtEntry == null || r.scoreAwayAtEntry == null ? '- -' : `${r.scoreHomeAtEntry}-${r.scoreAwayAtEntry}`;
const pnlStr = (v: number): string => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const pnlColor = (v: number): string => (v > 0 ? '#4ade80' : v < 0 ? '#fb7185' : '#8a8a8a');

// ── Kèo label (colored Tài/Xỉu) ──────────────────────────────────────────────
function KeoLabel({ market, side }: { market: 'h1' | 'ft'; side: 'tai' | 'xiu' }) {
  const tai = side === 'tai';
  return (
    <span className="font-semibold">
      <span className="text-[#777]">{market === 'h1' ? 'H1' : 'FT'} </span>
      <span style={{ color: tai ? '#4ade80' : '#fb7185' }}>{tai ? 'Tài' : 'Xỉu'}</span>
    </span>
  );
}

// ── KQ cell (✅/½✅/❌/½❌/➖/⏳ + pnl thật) ───────────────────────────────────
function KqCell({ result, pnl }: { result: TxReportRow['result']; pnl: number | null }) {
  const p = pnl ?? 0;
  const sg = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)); // pnl thật (Malay âm: thua < 1u)
  if (result === 'win') return <span style={{ color: '#4ade80' }}>✅ {sg(p)}</span>;
  if (result === 'half-win') return <span style={{ color: '#86efac' }}>½✅ {sg(p)}</span>;
  if (result === 'lose') return <span style={{ color: '#fb7185' }}>❌ {sg(p)}</span>;
  if (result === 'half-lose') return <span style={{ color: '#fda4af' }}>½❌ {sg(p)}</span>;
  if (result === 'push') return <span style={{ color: '#8a8a8a' }}>➖ 0</span>;
  return <span style={{ color: '#9ca3af' }}>⏳</span>;
}

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
  const rows = data?.rows ?? [];
  const selAgg = summary.find((s) => s.calcVersion === selected);

  // Phân trang bảng chi tiết (20/trang).
  const pageSize = data?.pageSize ?? 20;
  const totalRows = data?.totalRows ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const goPage = (p: number) => {
    const np = Math.min(Math.max(p, 0), totalPages - 1);
    if (np === page) return;
    setPage(np);
    load(selected, np);
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Header + version selector */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
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

      {!error && !loading && rows.length === 0 && summary.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">⏳</div>
          <div className="text-[14px] text-[#888]">Chưa có kèo nào</div>
        </div>
      ) : (
        <>
          {/* ── So sánh version (luôn tất cả version) ── */}
          <div className="mb-6">
            <div className="mb-2 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">So sánh version</div>
            <div className="overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#141414]">
              <table className="w-full text-left text-[12px] md:text-[13px] tabular-nums">
                <thead>
                  <tr className="border-b border-[#2a2a2a] text-[#888]">
                    <th className="px-3 py-2 font-semibold">Version</th>
                    <th className="px-3 py-2 font-semibold">Kèo</th>
                    <th className="px-3 py-2 font-semibold">W/L/P</th>
                    <th className="px-3 py-2 font-semibold">WinRate</th>
                    <th className="px-3 py-2 font-semibold">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr
                      key={s.calcVersion}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(s.calcVersion)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.calcVersion); }
                      }}
                      className={`cursor-pointer border-b border-[#222] hover:bg-white/[.04] ${s.calcVersion === selected ? 'bg-[#38bdf8]/10' : ''}`}
                    >
                      <td className="px-3 py-2 font-semibold text-white">
                        <span className="inline-flex items-center gap-1.5">
                          {s.calcVersion}
                          {s.openBets > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-[#4ade80]" title={`${s.openBets} kèo chưa settle`}>
                              <span className="tx-open-dot" />đang vô kèo
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#bbb]">{s.withNhoi.bets}</td>
                      <td className="px-3 py-2 text-[#bbb]">{wlp(s.withNhoi)}</td>
                      <td className="px-3 py-2 text-[#bbb]">{winRatePct(s.withNhoi.winRate)}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: pnlColor(s.withNhoi.pnl) }}>{pnlStr(s.withNhoi.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Tổng (version đang chọn): tính chung tất cả kèo ── */}
          {selAgg && (
            <div className="mb-6">
              <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] tabular-nums">
                  <span className="text-[#888]">Kèo <span className="font-bold text-white">{selAgg.withNhoi.bets}</span></span>
                  <span className="text-[#888]">W/L/P <span className="font-bold text-white">{wlp(selAgg.withNhoi)}</span></span>
                  <span className="text-[#888]">WinRate <span className="font-bold text-white">{winRatePct(selAgg.withNhoi.winRate)}</span></span>
                  <span className="text-[#888]">PnL <span className="font-bold" style={{ color: pnlColor(selAgg.withNhoi.pnl) }}>{pnlStr(selAgg.withNhoi.pnl)}</span></span>
                </div>
              </div>
            </div>
          )}

          {/* ── Chi tiết kèo ── */}
          <div className="mb-2 text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">
            Chi tiết {selected === 'all' ? '(tất cả version)' : selected}
            <span className="ml-1 font-normal text-[#888]">· {totalRows} kèo · 20/trang</span>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-6 text-center text-[13px] text-[#888]">
              Chưa có kèo nào
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-lg border border-[#2a2a2a] bg-[#141414] md:block">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <thead>
                    <tr className="border-b border-[#2a2a2a] text-[#888]">
                      <th className="px-3 py-2 font-semibold">Giờ VN</th>
                      <th className="px-3 py-2 font-semibold">Trận</th>
                      <th className="px-3 py-2 font-semibold">Kèo</th>
                      <th className="px-3 py-2 font-semibold">Line</th>
                      <th className="px-3 py-2 font-semibold">Giá</th>
                      <th className="px-3 py-2 font-semibold">P</th>
                      <th className="px-3 py-2 font-semibold">Tỉ số vào</th>
                      <th className="px-3 py-2 font-semibold">Tổng cuối</th>
                      <th className="px-3 py-2 font-semibold">KQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`border-b border-[#222] ${r.result == null ? 'tx-pending-row' : ''}`}>
                        <td className="px-3 py-2 text-[#bbb]">{vnTime(r.entryAt)}</td>
                        <td className="px-3 py-2">
                          <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                          <span className="text-[#555]"> vs </span>
                          <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                        </td>
                        <td className="px-3 py-2"><KeoLabel market={r.market} side={r.side} /></td>
                        <td className="px-3 py-2 text-[#bbb]">{r.lineRaw ?? r.line}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{Math.round(r.pModel * 100)}%</td>
                        <td className="px-3 py-2 text-[#bbb] tabular-nums">{entryScore(r)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.finalTotal ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold"><KqCell result={r.result} pnl={r.pnl} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile/tablet card list */}
              <div className="flex flex-col gap-2 md:hidden">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-lg border border-[#2a2a2a] bg-[#141414] p-3 ${r.result == null ? 'tx-pending' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[13px] font-semibold truncate">
                        <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                        <span className="text-[#555]"> vs </span>
                        <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-[#888] tabular-nums">{vnTime(r.entryAt)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
                      <KeoLabel market={r.market} side={r.side} />
                      <span className="text-[#888]">line <span className="text-[#bbb]">{r.lineRaw ?? r.line}</span></span>
                      <span className="text-[#888]">giá <span className="text-[#bbb]">{r.price.toFixed(2)}</span></span>
                      <span className="text-[#888]">P <span className="text-[#bbb]">{Math.round(r.pModel * 100)}%</span></span>
                      <span className="text-[#888]">vào <span className="text-[#bbb]">{entryScore(r)}</span></span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
                      <span className="text-[#888]">Tổng cuối <span className="text-[#bbb]">{r.finalTotal ?? '—'}</span></span>
                      <span className="font-semibold"><KqCell result={r.result} pnl={r.pnl} /></span>
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2 text-[12px]">
                  <button
                    onClick={() => goPage(page - 1)}
                    disabled={page <= 0}
                    className="rounded-lg border border-[#2a2a2a] bg-white/[.05] px-3 py-1.5 text-white hover:bg-white/[.1] disabled:cursor-not-allowed disabled:opacity-40"
                  >← Trước</button>
                  <span className="text-[#bbb] tabular-nums">Trang {page + 1} / {totalPages}</span>
                  <button
                    onClick={() => goPage(page + 1)}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-[#2a2a2a] bg-white/[.05] px-3 py-1.5 text-white hover:bg-white/[.1] disabled:cursor-not-allowed disabled:opacity-40"
                  >Sau →</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
