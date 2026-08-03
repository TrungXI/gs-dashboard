'use client';

import { useEffect } from 'react';
import { getTxRule } from '../lib/txRules';

// Modal xem RULE của 1 bot (calc_version). Mở từ nút "📖 Rule" trong Báo cáo T/X.
export default function TxRuleModal({ version, onClose }: { version: string; onClose: () => void }) {
  const r = getTxRule(version);

  // ESC để đóng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Section = ({ icon, title, items }: { icon: string; title: string; items: string[] }) => (
    <div className="mb-4">
      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[#fbbf24]">
        {icon} {title}
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#d4d4d4]">
            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#555]" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#141414] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#2a2a2a] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[15px] font-bold text-white">
              <span>{r.emoji}</span>
              <span className="truncate">{version}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-[#9ca3af]">{r.headline}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="shrink-0 rounded-md px-2 py-1 text-[18px] leading-none text-[#888] transition hover:bg-white/[.08] hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-md border border-[#fb7185]/40 bg-[#fb7185]/10 px-2 py-1 text-[12px] font-semibold text-[#fda4af]">
              Cửa: {r.side}
            </span>
            <span className="rounded-md border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-2 py-1 text-[12px] font-semibold text-[#7dd3fc]">
              ⏱ {r.when}
            </span>
          </div>

          <Section icon="🧠" title="Chiến lược" items={r.strategy} />
          <Section icon="🗂" title="Lấy data gì" items={r.data} />
          <Section icon="✅" title="Điều kiện VÔ KÈO" items={r.entry} />

          {r.note && (
            <div className="mt-2 rounded-lg border border-[#fbbf24]/25 bg-[#fbbf24]/[.07] px-3 py-2 text-[12.5px] leading-snug text-[#e5c893]">
              💡 {r.note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
