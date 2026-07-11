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

export default function VoltaUpdateDrawer({ currentMatches, onUpdate, onClose }: Props) {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem(LS_TOKEN);
    if (saved) setToken(saved);
  }, []);

  async function handleFetch() {
    if (!token) return;
    localStorage.setItem(LS_TOKEN, token);
    setStatus('fetching');
    setLog([]);
    setCount(0);

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
      setCount(fetched.length);

      // Keep existing matches for other dates, replace all (Volta has no stable fromDate filter)
      const sorted = fetched.sort((a, b) => {
        const parse = (m: VoltaMatch) => {
          const [d, mo, y] = m.date.split('/');
          return new Date(`${y}-${mo}-${d}T${m.time}`).getTime();
        };
        return parse(b) - parse(a);
      });

      localStorage.setItem(LS_VOLTA, JSON.stringify(sorted));
      const now = new Date().toLocaleString('vi-VN');
      localStorage.setItem(LS_VOLTA_AT, now);

      setLog((prev) => [...prev, `✓ Đã tải ${fetched.length} trận`, `Cập nhật lúc ${now}`]);
      setStatus('done');
      onUpdate(sorted);
    } catch (e) {
      setLog((prev) => [...prev, `Lỗi kết nối: ${String(e)}`]);
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/60" onClick={onClose}>
      <div
        className="h-full w-[380px] overflow-y-auto bg-[#111] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-[15px] font-bold text-white">⚡ Cập nhật Volta</div>
            <div className="text-[11px] text-white/40">Tải 100 trận mới nhất</div>
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
            <div className="rounded-lg bg-white/[.04] px-3.5 py-3 text-[12px] text-white/50">
              Hiện có{' '}
              <strong className="text-white">{currentMatches.length}</strong> trận Volta
            </div>
          )}

          <button
            onClick={handleFetch}
            disabled={!token || status === 'fetching'}
            className="w-full rounded-lg bg-[#17a2b8] px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {status === 'fetching' ? 'Đang tải...' : '⚡ Tải dữ liệu Volta'}
          </button>

          {log.length > 0 && (
            <div className="rounded-lg bg-[#0a0a0a] p-3.5 font-mono text-[11px] space-y-1">
              {log.map((l, i) => (
                <div key={i} className={l.startsWith('✓') ? 'text-[#4ade80]' : l.startsWith('Lỗi') ? 'text-[#f87171]' : 'text-white/60'}>
                  {l}
                </div>
              ))}
              {status === 'done' && count > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[#4ade80] font-bold">
                  ✓ Đã cập nhật {count} trận Volta
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
