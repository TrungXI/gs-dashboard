'use client';

import { useState, useEffect } from 'react';
import type { VoltaMatch } from '../types/voltaMatch';
import { apiToVoltaRow } from '../lib/processVoltaData';

const LS_TOKEN = 'gs_token';
const LS_VOLTA = 'volta_matches';
const LS_VOLTA_AT = 'volta_updated_at';

interface Props {
  currentMatches: VoltaMatch[];
  onUpdate: (matches: VoltaMatch[]) => void;
  onClose: () => void;
}

function sortVolta(matches: VoltaMatch[]): VoltaMatch[] {
  return [...matches].sort((a, b) => {
    const parse = (m: VoltaMatch) => {
      const [d, mo, y] = m.date.split('/');
      return new Date(`${y}-${mo}-${d}T${m.time}:00`).getTime();
    };
    return parse(b) - parse(a);
  });
}

export default function VoltaUpdateDrawer({ currentMatches, onUpdate, onClose }: Props) {
  const [token, setToken] = useState('69-6aed7dc417eb4882d88c6899ae3c0ae1');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(LS_TOKEN);
    if (saved) setToken(saved);
  }, []);

  async function handleFetch() {
    if (!token) return;
    localStorage.setItem(LS_TOKEN, token);
    setStatus('fetching');
    setLog([]);
    setNewCount(0);

    try {
      setLog(['Đang tải 100 trận Volta mới nhất...']);
      const res = await fetch('/api/fetch-volta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json() as { ok: boolean; data?: Record<string, unknown>[]; error?: string };

      if (!json.ok || !json.data) {
        setLog((prev) => [...prev, `Lỗi: ${json.error ?? 'Unknown'}`]);
        setStatus('error');
        return;
      }

      const fetched = json.data.map(apiToVoltaRow);

      // Merge by matchId — keep all existing + add only new ones
      const existingIds = new Set(currentMatches.map(m => m.matchId));
      const freshMatches = fetched.filter(m => !existingIds.has(m.matchId));
      const merged = sortVolta([...currentMatches, ...freshMatches]);

      setNewCount(freshMatches.length);
      localStorage.setItem(LS_VOLTA, JSON.stringify(merged));
      const now = new Date().toLocaleString('vi-VN');
      localStorage.setItem(LS_VOLTA_AT, now);

      // Count by date for display
      const byDate: Record<string, number> = {};
      for (const m of merged) byDate[m.date] = (byDate[m.date] || 0) + 1;
      const dateLines = Object.entries(byDate)
        .sort(([a], [b]) => {
          const parse = (s: string) => { const [d, mo, y] = s.split('/'); return +y * 10000 + +mo * 100 + +d; };
          return parse(a) - parse(b);
        })
        .map(([d, n]) => `  ${d}: ${n} trận`);

      setLog((prev) => [
        ...prev,
        `✓ +${freshMatches.length} trận mới (tổng: ${merged.length})`,
        ...dateLines,
        `Cập nhật lúc ${now}`,
      ]);
      setStatus('done');
      onUpdate(merged);
    } catch (e) {
      setLog((prev) => [...prev, `Lỗi kết nối: ${String(e)}`]);
      setStatus('error');
    }
  }

  // Count by date for sidebar info
  const byDate: Record<string, number> = {};
  for (const m of currentMatches) byDate[m.date] = (byDate[m.date] || 0) + 1;
  const dateSummary = Object.entries(byDate)
    .sort(([a], [b]) => {
      const parse = (s: string) => { const [d, mo, y] = s.split('/'); return +y * 10000 + +mo * 100 + +d; };
      return parse(a) - parse(b);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-[380px] overflow-y-auto bg-[#111] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-white">⚡ Cập nhật Volta</div>
            <div className="text-[11px] text-white/40">Tích lũy trận mới — API chỉ trả 100 trận gần nhất</div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">
            ×
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              Token
            </div>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="69-xxxxxxx..."
              className="w-full rounded-lg bg-white/[.07] px-3 py-2 text-sm text-white placeholder-white/20 outline-none focus:ring-1 focus:ring-[#17a2b8]"
            />
          </div>

          {currentMatches.length > 0 && (
            <div className="rounded-lg bg-white/[.04] px-3.5 py-3 text-[12px] space-y-1">
              <div className="text-white/50">
                Đang có <strong className="text-white">{currentMatches.length}</strong> trận tích lũy:
              </div>
              {dateSummary.map(([d, n]) => (
                <div key={d} className="flex justify-between text-[11px] text-white/40">
                  <span>{d}</span>
                  <span>{n} trận</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleFetch}
            disabled={!token || status === 'fetching'}
            className="w-full rounded-lg bg-[#17a2b8] px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {status === 'fetching' ? 'Đang tải...' : '⚡ Fetch & Merge trận mới'}
          </button>

          {log.length > 0 && (
            <div className="rounded-lg bg-[#0a0a0a] p-3.5 font-mono text-[11px] space-y-1">
              {log.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.startsWith('✓') ? 'text-[#4ade80]' :
                    l.startsWith('Lỗi') ? 'text-[#f87171]' :
                    l.startsWith('  ') ? 'text-white/40' :
                    'text-white/60'
                  }
                >
                  {l}
                </div>
              ))}
              {status === 'done' && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[#4ade80] font-bold">
                  {newCount > 0 ? `✓ +${newCount} trận mới được thêm` : '✓ Không có trận mới'}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-white/[.06] px-3.5 py-3 text-[11px] text-white/30 leading-relaxed">
            💡 API Volta chỉ trả 100 trận (~2 giờ). Nhấn fetch mỗi 1-2 giờ để tích lũy dữ liệu nhiều ngày.
          </div>
        </div>
      </div>
    </div>
  );
}
