'use client';

import { useEffect, useState } from 'react';
import { LoadingState } from './Spinner';
import type { HcWatchRow, HcWatchSummary } from '../app/api/gs-hc-watch/route';

// ── Response shape from GET /api/gs-hc-watch ────────────────────────────────
interface HcWatchResponse {
  mode?: 'team' | 'pair';
  team?: string;
  home?: string;
  away?: string;
  rows?: HcWatchRow[];
  summary?: HcWatchSummary[];
  error?: string;
}

// Which filter is active: one of the two teams, or the pairing (default).
type Filter = 'home' | 'away' | 'pair';

// ket_qua → color. Matches the dark palette used across GSLive.
function ketQuaClass(kq: string | null): string {
  switch (kq) {
    case 'AN':       return 'text-[#22c55e] font-bold';   // ăn cả — green
    case 'an-nua':   return 'text-[#86efac]';             // ăn nửa — light green
    case 'hoa-von':  return 'text-[#888]';                // hòa vốn — gray
    case 'thua-nua': return 'text-[#fb923c]';             // thua nửa — orange
    case 'THUA':     return 'text-[#f87171] font-bold';   // thua cả — red
    default:         return 'text-[#aaa]';
  }
}

/** One team's summary card: Ăn 1 trái %, Gỡ-hòa+ %, P&L, record. */
function SummaryCard({ s }: { s: HcWatchSummary }) {
  const pnlColor = s.pnl > 0 ? 'text-[#22c55e]' : s.pnl < 0 ? 'text-[#f87171]' : 'text-[#888]';
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
      <div className="text-[12px] font-bold text-white truncate mb-1.5">{s.team}</div>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#aaa]">🎯 Ăn 1 trái</span>
          <span className="text-[13px] font-extrabold text-[#4ade80] tabular-nums">
            {s.pct_an1}% <span className="text-[10px] font-normal text-[#666]">({s.an1trai}/{s.n})</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#aaa]">🤝 Gỡ-hòa+</span>
          <span className="text-[13px] font-bold text-[#60a5fa] tabular-nums">{s.pct_hoaplus}%</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#aaa]">P&amp;L</span>
          <span className={`text-[12px] font-bold tabular-nums ${pnlColor}`}>
            {s.pnl > 0 ? '+' : ''}{s.pnl}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-[#aaa]">Ăn - Thua</span>
          <span className="text-[12px] tabular-nums text-[#ccc]">
            <span className="text-[#22c55e]">{s.an}</span>
            <span className="text-[#555]"> - </span>
            <span className="text-[#f87171]">{s.thua}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function HcWatchDrawer({
  home,
  away,
  onClose,
}: {
  home: string;
  away: string;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('pair'); // default: pairing
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<HcWatchRow[]>([]);
  const [summary, setSummary] = useState<HcWatchSummary[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setRows([]);
    setSummary([]);

    const url =
      filter === 'pair'
        ? `/api/gs-hc-watch?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`
        : `/api/gs-hc-watch?team=${encodeURIComponent(filter === 'home' ? home : away)}`;

    fetch(url)
      .then(async (r) => {
        const json = (await r.json()) as HcWatchResponse;
        if (!alive) return;
        if (json.error) {
          setError(
            r.status === 503
              ? 'Chưa cấu hình ANALYSIS_DATABASE_URL — không kết nối được DB thống kê.'
              : json.error,
          );
          return;
        }
        setRows(json.rows ?? []);
        setSummary(json.summary ?? []);
      })
      .catch(() => {
        if (alive) setError('Không tải được dữ liệu kèo giá.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [filter, home, away]);

  const filterBtn = (key: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      className={`flex-1 min-w-0 truncate rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
        filter === key
          ? 'border-[#f59e0b]/50 bg-[#f59e0b]/10 text-[#fbbf24]'
          : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#444]'
      }`}
      title={label}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] w-full md:w-[680px] bg-[#111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#222] flex-shrink-0 bg-[#0d0d0d]">
          <span className="text-[13px] font-bold text-[#fbbf24]">📊</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-white truncate">
              Kèo giá −0.3/−0.5 · {home} <span className="text-[#555] font-normal">vs</span> {away}
            </div>
            <div className="text-[10px] text-[#555] mt-0.5">
              {loading ? 'Đang tải…' : error ? 'Lỗi tải dữ liệu' : `${rows.length} kèo band`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-white text-lg leading-none flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1.5 px-3 py-2.5 border-b border-[#1a1a1a] flex-shrink-0 bg-[#0d0d0d]">
          {filterBtn('home', home)}
          {filterBtn('away', away)}
          {filterBtn('pair', `${home} vs ${away}`)}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && <LoadingState label="Đang tải kèo giá…" />}

          {!loading && error && (
            <div className="m-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[12px] text-[#f87171]">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Summary strip */}
              {summary.length > 0 && (
                <div className="flex gap-2 px-3 py-3 border-b border-[#1a1a1a]">
                  {summary.map((s) => (
                    <SummaryCard key={s.team} s={s} />
                  ))}
                </div>
              )}

              {/* Rows table */}
              {rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-[#666]">
                  Chưa có kèo band nào cho lựa chọn này.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-[#1a1a1a]">
                        {['Trận (opp)', 'Vô lúc', 'Phút', 'Cửa', 'Kèo', 'Giá', 'HT', 'FT', 'KQ'].map(
                          (h) => (
                            <th
                              key={h}
                              className="border-b border-[#2a2a2a] px-2 py-2 text-left text-[11px] font-semibold text-[#aaa] whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.event_id}
                          className="odd:bg-[#141414] even:bg-[#181818]"
                        >
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#ccc] max-w-[160px] truncate">
                            {r.opp_team ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#888] whitespace-nowrap tabular-nums">
                            {r.entry_score ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#888] whitespace-nowrap tabular-nums">
                            {r.minute != null ? `${r.minute}'` : '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#aaa] whitespace-nowrap">
                            {r.side ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#fbbf24] whitespace-nowrap tabular-nums">
                            {r.handicap ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#60a5fa] whitespace-nowrap tabular-nums">
                            {r.price ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#aaa] whitespace-nowrap tabular-nums">
                            {r.ht ?? '—'}
                          </td>
                          <td className="border-b border-[#222] px-2 py-1.5 text-[#aaa] whitespace-nowrap tabular-nums">
                            {r.ft ?? '—'}
                          </td>
                          <td
                            className={`border-b border-[#222] px-2 py-1.5 whitespace-nowrap ${ketQuaClass(r.ket_qua)}`}
                          >
                            {r.ket_qua ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
