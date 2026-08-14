'use client';

import { useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import type { HcapDetailRow, HcapDetailResponse } from '../app/api/gs-hcap-detail/route';

// ISO → giờ VN (Asia/Ho_Chi_Minh, UTC+7). extend vnTime của TxDetailDrawer để có ĐỦ ngày.
function vnDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// Nhãn kèo: leg (Kèo dưới / Kèo trên / Tài) + side thô (nếu có).
function LegLabel({ leg, legLabel }: { leg: string; legLabel: string }) {
  const over = leg === 'over';
  return (
    <span className="font-semibold" style={{ color: over ? '#4ade80' : '#fb7185' }}>
      {legLabel}
    </span>
  );
}

// KQ cell — giống KqCell của TxDetailDrawer.
function KqCell({ result, pnl }: { result: HcapDetailRow['result']; pnl: number | null }) {
  const p = pnl ?? 0;
  const sg = (v: number) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  if (result === 'win') return <span style={{ color: '#4ade80' }}>✅ {sg(p)}</span>;
  if (result === 'half-win') return <span style={{ color: '#86efac' }}>½✅ {sg(p)}</span>;
  if (result === 'lose') return <span style={{ color: '#fb7185' }}>❌ {sg(p)}</span>;
  if (result === 'half-lose') return <span style={{ color: '#fda4af' }}>½❌ {sg(p)}</span>;
  if (result === 'push') return <span style={{ color: '#8a8a8a' }}>➖ 0</span>;
  return <span style={{ color: '#9ca3af' }}>⏳</span>;
}

const fmt = (v: number | null): string => (v == null ? '—' : String(v));
const finalScore = (r: HcapDetailRow): string =>
  r.finalHome == null || r.finalAway == null ? '—' : `${r.finalHome}-${r.finalAway}`;

// Drawer chi tiết 1 handicap model (A/B/C) — đọc /api/gs-hcap-detail.
export default function HcapDetailDrawer({ model, label, onClose }: { model: string; label: string; onClose: () => void }) {
  const [rows, setRows] = useState<HcapDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/gs-hcap-detail?model=${encodeURIComponent(model)}`, { cache: 'no-store' })
      .then((res) => res.json() as Promise<HcapDetailResponse>)
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || 'Lỗi tải chi tiết');
        setRows(json.rows);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [model]);

  // Esc để đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] flex w-[calc(100%-2.75rem)] flex-col overflow-hidden border-l border-[#2a2a2a] bg-[#111] md:w-[760px]">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#222] bg-[#0d0d0d] px-4 py-3">
          <span className="text-[13px] font-bold text-[#fbbf24]">📋</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-white">Chi tiết kèo · {model} · {label}</div>
            <div className="mt-0.5 text-[10px] text-[#555]">
              {loading && rows.length === 0 ? 'Đang tải…' : `${rows.length} kèo`}
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

          {!error && loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-[#666]">
              <Spinner size={14} /> Đang tải…
            </div>
          ) : !error && rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[#666]">chưa có kèo</div>
          ) : !error ? (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <thead>
                    <tr className="sticky top-0 border-b border-[#2a2a2a] bg-[#141414] text-[#888]">
                      <th className="px-3 py-2 font-semibold">Thời điểm (VN)</th>
                      <th className="px-3 py-2 font-semibold">Trận</th>
                      <th className="px-3 py-2 font-semibold">Loại</th>
                      <th className="px-3 py-2 font-semibold">Kèo</th>
                      <th className="px-3 py-2 font-semibold">Line</th>
                      <th className="px-3 py-2 font-semibold">Giá</th>
                      <th className="px-3 py-2 font-semibold">Phút</th>
                      <th className="px-3 py-2 font-semibold">Tỉ số vào</th>
                      <th className="px-3 py-2 font-semibold">Tỉ số cuối</th>
                      <th className="px-3 py-2 font-semibold">KQ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={`border-b border-[#222] ${r.result == null ? 'tx-pending-row' : ''}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-[#bbb]">
                          <div>{vnDateTime(r.requestedAt)}</div>
                          {r.settledAt && (
                            <div className="mt-0.5 text-[10px] text-[#666]">chấm {vnDateTime(r.settledAt)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span style={{ color: '#4ade80' }}>{r.homeTeam}</span>
                          <span className="text-[#555]"> vs </span>
                          <span style={{ color: '#fb7185' }}>{r.awayTeam}</span>
                        </td>
                        <td className="px-3 py-2 text-[#888]">{r.matchType}</td>
                        <td className="px-3 py-2"><LegLabel leg={r.leg} legLabel={r.legLabel} /></td>
                        <td className="px-3 py-2 text-[#bbb]">{fmt(r.line)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{r.odds == null ? '—' : r.odds.toFixed(2)}</td>
                        <td className="px-3 py-2 text-[#bbb]">{fmt(r.trigMinute)}</td>
                        <td className="px-3 py-2 text-[#bbb] tabular-nums">{r.trigScore ?? '—'}</td>
                        <td className="px-3 py-2 text-[#bbb] tabular-nums">{finalScore(r)}</td>
                        <td className="px-3 py-2 font-semibold"><KqCell result={r.result} pnl={r.cashPnl} /></td>
                      </tr>
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
                      <span className="shrink-0 text-[11px] text-[#888] tabular-nums">{vnDateTime(r.requestedAt)}</span>
                    </div>
                    {r.settledAt && (
                      <div className="mt-0.5 text-[10px] text-[#666] tabular-nums">chấm {vnDateTime(r.settledAt)}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
                      <LegLabel leg={r.leg} legLabel={r.legLabel} />
                      <span className="text-[#888]">{r.matchType}</span>
                      <span className="text-[#888]">line <span className="text-[#bbb]">{fmt(r.line)}</span></span>
                      <span className="text-[#888]">giá <span className="text-[#bbb]">{r.odds == null ? '—' : r.odds.toFixed(2)}</span></span>
                      <span className="text-[#888]">phút <span className="text-[#bbb]">{fmt(r.trigMinute)}</span></span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
                      <span className="text-[#888]">vào <span className="text-[#bbb]">{r.trigScore ?? '—'}</span></span>
                      <span className="text-[#888]">cuối <span className="text-[#bbb]">{finalScore(r)}</span></span>
                      <span className="font-semibold"><KqCell result={r.result} pnl={r.cashPnl} /></span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-center px-3 py-4">
                <span className="text-[11px] text-[#555]">Đã hết · {rows.length} kèo (mới nhất 100)</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
