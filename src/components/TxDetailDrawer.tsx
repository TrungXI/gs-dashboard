'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import type { TxReportRow, TxReportResponse, Arm29 } from '../app/api/gs-tx-report/route';

// V.Bot 16 kèo rung 16p: 1 mốc OU (phút 25 / phút 32) — hiện line + Xỉu + Tài.
function ArmLine({ label, color, arm }: { label: string; color: string; arm: Arm29 }) {
  return (
    <div className="mt-1 rounded border border-[#38bdf8]/25 bg-[#38bdf8]/[.06] px-2 py-1 text-[11px] leading-relaxed text-[#9ca3af]">
      <span style={{ color }}>{label} (tỉ số {arm.score}):</span>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        {arm.ou.map((o, i) => (
          <span key={i}>
            <span className="text-[#bbb]">OU {o.line}</span>{' '}
            <span className="text-[#86efac]">Xỉu {o.xiu ?? '—'}</span>{' '}
            <span className="text-[#fca5a5]">Tài {o.tai ?? '—'}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
// V.Bot 16: timeline giá tại phút 25 → phút 32 → LÚC VÀO (giá over vào lệnh).
function Vbot16Timeline({ r }: { r: TxReportRow }) {
  if (!r.arm25 && !r.arm32 && !r.entryOdds) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {r.arm25 && <ArmLine label={`📍 Phút ${r.arm25.min} — cắm mốc (ghi Xỉu)`} color="#7dd3fc" arm={r.arm25} />}
      {r.arm32 && <ArmLine label={`📍 Phút ${r.arm32.min} — chốt cửa sổ (đếm bàn 25→32)`} color="#fbbf24" arm={r.arm32} />}
      {r.entryOdds && (
        <div className="rounded border border-[#4ade80]/30 bg-[#4ade80]/[.06] px-2 py-1 text-[11px] text-[#9ca3af]">
          <span className="text-[#4ade80]">✅ VÀO LỆNH:</span>{' '}
          <span className="text-[#bbb]">OVER {r.entryOdds.line}</span>{' '}
          <span className="text-[#fca5a5]">@ giá {r.entryOdds.over ?? '—'}</span>
          {r.entryOdds.under != null && r.entryOdds.under !== '' && (
            <span className="text-[#86efac]"> · Xỉu {r.entryOdds.under}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Kèo rung VBot14: OU line Tài/Xỉu tại phút 29 (lúc cắm cờ).
function Arm29Row({ arm29 }: { arm29: Arm29 }) {
  return (
    <div className="mt-1.5 rounded border border-[#38bdf8]/25 bg-[#38bdf8]/[.06] px-2 py-1 text-[11px] leading-relaxed text-[#9ca3af]">
      <span className="text-[#7dd3fc]">📍 Phút {arm29.min} (tỉ số {arm29.score}) — OU lúc cắm cờ:</span>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        {arm29.ou.map((o, i) => (
          <span key={i}>
            <span className="text-[#bbb]">OU {o.line}</span>{' '}
            <span className="text-[#86efac]">Xỉu {o.xiu ?? '—'}</span>{' '}
            <span className="text-[#fca5a5]">Tài {o.tai ?? '—'}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Helpers (giống bảng chi tiết cũ trong TxReport) ──────────────────────────

// entryAt ISO → giờ VN (UTC+7) "HH:mm".
function vnTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const entryScore = (r: { scoreHomeAtEntry: number | null; scoreAwayAtEntry: number | null }): string =>
  r.scoreHomeAtEntry == null || r.scoreAwayAtEntry == null ? '- -' : `${r.scoreHomeAtEntry}-${r.scoreAwayAtEntry}`;

function KeoLabel({ market, side }: { market: 'h1' | 'ft'; side: 'tai' | 'xiu' }) {
  const tai = side === 'tai';
  return (
    <span className="font-semibold">
      <span className="text-[#777]">{market === 'h1' ? 'H1' : 'FT'} </span>
      <span style={{ color: tai ? '#4ade80' : '#fb7185' }}>{tai ? 'Tài' : 'Xỉu'}</span>
    </span>
  );
}
function KqCell({ result, pnl }: { result: TxReportRow['result']; pnl: number | null }) {
  const p = pnl ?? 0;
  const sg = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  if (result === 'win') return <span style={{ color: '#4ade80' }}>✅ {sg(p)}</span>;
  if (result === 'half-win') return <span style={{ color: '#86efac' }}>½✅ {sg(p)}</span>;
  if (result === 'lose') return <span style={{ color: '#fb7185' }}>❌ {sg(p)}</span>;
  if (result === 'half-lose') return <span style={{ color: '#fda4af' }}>½❌ {sg(p)}</span>;
  if (result === 'push') return <span style={{ color: '#8a8a8a' }}>➖ 0</span>;
  return <span style={{ color: '#9ca3af' }}>⏳</span>;
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export default function TxDetailDrawer({ version, onClose }: { version: string; onClose: () => void }) {
  const [rows, setRows] = useState<TxReportRow[]>([]);
  const [page, setPage] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (p: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        if (version && version !== 'all') q.set('version', version);
        else q.set('version', 'all');
        q.set('page', String(p));
        const res = await fetch(`/api/gs-tx-report?${q.toString()}`, { cache: 'no-store' });
        const json = (await res.json()) as TxReportResponse & { error?: string };
        if (!json.ok) throw new Error(json.error || 'Lỗi tải chi tiết');
        setRows((prev) => (append ? [...prev, ...json.rows] : json.rows));
        setTotalRows(json.totalRows);
        setPage(json.page);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [version],
  );

  // Đổi version → tải lại từ trang 0.
  useEffect(() => {
    setRows([]);
    setPage(0);
    fetchPage(0, false);
  }, [fetchPage]);

  // Esc để đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasMore = rows.length < totalRows;
  const label = version === 'all' ? 'Tất cả version' : version;

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] flex w-[calc(100%-2.75rem)] flex-col overflow-hidden border-l border-[#2a2a2a] bg-[#111] md:w-[760px]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#222] bg-[#0d0d0d] px-4 py-3">
          <span className="text-[13px] font-bold text-[#fbbf24]">📋</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-white">Chi tiết kèo · {label}</div>
            <div className="mt-0.5 text-[10px] text-[#555]">
              {loading && rows.length === 0 ? 'Đang tải…' : `${rows.length}/${totalRows} kèo`}
            </div>
          </div>
          <button onClick={onClose} className="flex-shrink-0 text-lg leading-none text-[#555] hover:text-white">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">{error}</div>
          )}

          {!error && rows.length === 0 && !loading ? (
            <div className="px-4 py-10 text-center text-[13px] text-[#666]">Chưa có kèo nào</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <thead>
                    <tr className="sticky top-0 border-b border-[#2a2a2a] bg-[#141414] text-[#888]">
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
                      <Fragment key={r.id}>
                      <tr className={`border-b border-[#222] ${r.result == null ? 'tx-pending-row' : ''}`}>
                        <td className="px-3 py-2 text-[#bbb]">{vnTime(r.entryAt)}</td>
                        <td className="px-3 py-2">
                          <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                          <span className="text-[#555]"> vs </span>
                          <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                        </td>
                        <td className="px-3 py-2">
                          <KeoLabel market={r.market} side={r.side} />
                        </td>
                        <td className="px-3 py-2 text-[#bbb]">{r.lineRaw ?? r.line}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{Math.round(r.pModel * 100)}%</td>
                        <td className="px-3 py-2 text-[#bbb] tabular-nums">{entryScore(r)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.finalTotal ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold">
                          <KqCell result={r.result} pnl={r.pnl} />
                        </td>
                      </tr>
                      {r.arm29 && (
                        <tr className="border-b border-[#222]">
                          <td colSpan={9} className="px-3 pb-2 pt-0">
                            <Arm29Row arm29={r.arm29} />
                          </td>
                        </tr>
                      )}
                      {(r.arm25 || r.arm32 || r.entryOdds) && (
                        <tr className="border-b border-[#222]">
                          <td colSpan={9} className="px-3 pb-2 pt-0">
                            <Vbot16Timeline r={r} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="flex flex-col gap-2 p-3 md:hidden">
                {rows.map((r) => (
                  <div key={r.id} className={`rounded-lg border border-[#2a2a2a] bg-[#141414] p-3 ${r.result == null ? 'tx-pending' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-[13px] font-semibold">
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
                      <span className="font-semibold">
                        <KqCell result={r.result} pnl={r.pnl} />
                      </span>
                    </div>
                    {r.arm29 && <Arm29Row arm29={r.arm29} />}
                    <Vbot16Timeline r={r} />
                  </div>
                ))}
              </div>

              {/* Load more */}
              <div className="flex justify-center px-3 py-4">
                {hasMore ? (
                  <button
                    onClick={() => fetchPage(page + 1, true)}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-white/[.05] px-4 py-2 text-[13px] text-white hover:bg-white/[.1] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? (
                      <>
                        <Spinner size={12} /> Đang tải…
                      </>
                    ) : (
                      `Tải thêm (còn ${totalRows - rows.length})`
                    )}
                  </button>
                ) : rows.length > 0 ? (
                  <span className="text-[11px] text-[#555]">Đã hết · {rows.length} kèo</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
