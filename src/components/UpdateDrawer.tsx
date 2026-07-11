'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Match } from '../types/match';
import { apiToRow, apiDateToDisplay, sortMatchesDesc, vnTodayIso } from '../lib/matchUtils';

const VN_DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function generateDays(n: number): string[] {
  // Anchor on Vietnam's "today" (UTC+7) so the day list matches how events are
  // categorized. Step back in whole days using a UTC-noon anchor to avoid DST/TZ drift.
  const [y, m, d] = vnTodayIso().split('-').map(Number);
  const baseMs = Date.UTC(y, m - 1, d, 12, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(baseMs - i * 86400000);
    const yyyy = day.getUTCFullYear();
    const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(day.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
}

interface FetchStatus {
  state: 'idle' | 'loading' | 'done' | 'error';
  count?: number;
  error?: string;
}

interface Props {
  dateCounts: Record<string, number>;
  onUpdate: (matches: Match[]) => void;
  onClose: () => void;
}

export default function UpdateDrawer({ dateCounts, onUpdate, onClose }: Props) {
  const [token, setToken] = useState('69-6aed7dc417eb4882d88c6899ae3c0ae1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetchStatus, setFetchStatus] = useState<Record<string, FetchStatus>>({});
  const [loading, setLoading] = useState(false);

  const days = generateDays(21);

  useEffect(() => {
    const saved = localStorage.getItem('gs_token');
    if (saved) setToken(saved);
    // default: select today
    setSelected(new Set([days[0]]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((d: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }, []);

  async function handleFetch() {
    if (!token.trim() || selected.size === 0) return;
    localStorage.setItem('gs_token', token.trim());
    setLoading(true);

    const dates = [...selected];
    const newStatus: Record<string, FetchStatus> = {};
    dates.forEach((d) => (newStatus[d] = { state: 'loading' }));
    setFetchStatus(newStatus);

    let fetchedMatches: Match[] = [];
    const updatedStatus = { ...newStatus };

    for (const date of dates) {
      try {
        const res = await fetch('/api/fetch-data', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: token.trim(), dates: [date] }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string; data?: Record<string, unknown[]> };
        if (!json.ok) throw new Error(json.error ?? 'Unknown error');
        const dayMatches = (json.data?.[date] ?? []).map((m) =>
          apiToRow(m as Record<string, unknown>),
        );
        fetchedMatches = fetchedMatches.concat(dayMatches);
        updatedStatus[date] = { state: 'done', count: dayMatches.length };
      } catch (e) {
        updatedStatus[date] = { state: 'error', error: String(e) };
      }
      setFetchStatus({ ...updatedStatus });
    }

    // Merge: keep existing matches for non-fetched dates, replace for fetched ones
    const fetchedDisplayDates = new Set(
      dates
        .filter((d) => updatedStatus[d].state === 'done')
        .map(apiDateToDisplay),
    );
    let existing: Match[] = [];
    try { existing = JSON.parse(localStorage.getItem('gs_matches') ?? '[]'); } catch { /* ignore */ }
    const kept = existing.filter((m) => !fetchedDisplayDates.has(m.date));
    const merged = sortMatchesDesc([...kept, ...fetchedMatches]);

    localStorage.setItem('gs_matches', JSON.stringify(merged));
    onUpdate(merged);
    setLoading(false);
  }

  const totalSelected = selected.size;
  const allDone = Object.values(fetchStatus).length > 0 &&
    Object.values(fetchStatus).every((s) => s.state === 'done' || s.state === 'error');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-[480px] flex-col rounded-xl border border-[#2a2a2a] bg-[#111] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2a2a2a] px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-white">Cập nhật dữ liệu</div>
            <div className="mt-0.5 text-[11px] text-[#555]">Fetch trực tiếp từ API</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[#222] text-[#888] hover:bg-[#333] hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Token */}
          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[#666]">
              Token API
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="69-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2.5 text-xs text-white placeholder:text-[#444] focus:border-[#17a2b8] focus:outline-none"
            />
          </div>

          {/* Date picker */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#666]">
                Chọn ngày ({totalSelected} đã chọn)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected(new Set(days))}
                  className="text-[10px] text-[#17a2b8] hover:text-white"
                >
                  Tất cả
                </button>
                <span className="text-[10px] text-[#333]">·</span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-[10px] text-[#17a2b8] hover:text-white"
                >
                  Bỏ hết
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {days.map((d, i) => {
                const displayDate = apiDateToDisplay(d);
                const count = dateCounts[displayDate];
                const status = fetchStatus[d];
                const isChecked = selected.has(d);
                const dayName = VN_DAYS[new Date(d).getUTCDay()];
                const label = i === 0 ? 'Hôm nay' : i === 1 ? 'Hôm qua' : dayName;

                return (
                  <div
                    key={d}
                    onClick={() => !loading && toggle(d)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                      isChecked
                        ? 'border-[#17a2b8]/40 bg-[#17a2b8]/10'
                        : 'border-[#1e1e1e] bg-[#161616] hover:bg-[#1e1e1e]'
                    } ${loading ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <div
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px] ${
                        isChecked
                          ? 'border-[#17a2b8] bg-[#17a2b8] text-white'
                          : 'border-[#333] bg-transparent'
                      }`}
                    >
                      {isChecked && '✓'}
                    </div>

                    <div className="flex flex-1 items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-white">{displayDate}</span>
                        <span className="ml-1.5 text-[11px] text-[#555]">{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {count !== undefined && status?.state !== 'done' && (
                          <span className="text-[11px] text-[#444]">{count} trận</span>
                        )}
                        {status?.state === 'loading' && (
                          <span className="text-[11px] text-[#fbbf24]">Đang tải...</span>
                        )}
                        {status?.state === 'done' && (
                          <span className="text-[11px] text-[#4ade80]">✓ {status.count} trận</span>
                        )}
                        {status?.state === 'error' && (
                          <span className="text-[11px] text-[#f87171]">Lỗi</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#2a2a2a] px-5 py-4">
          {allDone && (
            <div className="mb-3 text-center text-[12px] text-[#4ade80]">
              Đã cập nhật xong! Dashboard đã được làm mới.
            </div>
          )}
          <button
            onClick={handleFetch}
            disabled={loading || !token.trim() || selected.size === 0}
            className="w-full rounded-lg bg-[#17a2b8] px-4 py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#138496] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? `Đang tải ${Object.values(fetchStatus).filter((s) => s.state === 'done').length}/${Object.values(fetchStatus).length}...`
              : `Tải ${totalSelected > 0 ? totalSelected + ' ngày' : 'dữ liệu'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
