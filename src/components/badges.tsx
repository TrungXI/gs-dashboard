import type { CSSProperties } from 'react';

// One color per tournament (match type), so a badge's color tells you which
// league a team is in — instead of a distinct color per team (too noisy).
// Soft tint background + pastel text (mirrors the 7+ / result badges) so the
// data table reads calm on the dark theme instead of harsh solid fills.
const LEAGUE_COLOR: Record<
  '20p' | '20p_intl' | '16p',
  { bg: string; fg: string; border: string }
> = {
  // Soft tint + same-hue border + bright pastel text — the border gives the pill
  // definition on the dark theme so it reads clearly without a harsh solid fill.
  '20p': { bg: 'rgba(23,162,184,0.22)', border: 'rgba(23,162,184,0.55)', fg: '#67e8f9' }, // teal — Asian 20p
  '20p_intl': { bg: 'rgba(124,58,237,0.22)', border: 'rgba(124,58,237,0.55)', fg: '#c4b5fd' }, // violet — Intl 20p
  '16p': { bg: 'rgba(253,126,20,0.22)', border: 'rgba(253,126,20,0.55)', fg: '#fdba74' }, // orange — 16p
};

// winFt: đội thắng FT (toàn trận) → tô vàng (#fbbf24).
// winH1: đội thắng hiệp 1 → gạch chân đỏ (#f87171). Có thể đồng thời cả hai.
export function TeamBadge({
  name,
  type,
  winFt,
  winH1,
}: {
  name: string;
  type: '20p' | '20p_intl' | '16p';
  winFt?: boolean;
  winH1?: boolean;
}) {
  const c = LEAGUE_COLOR[type];
  const style: CSSProperties = winFt
    ? { background: 'rgba(251,191,36,0.20)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.60)' }
    : { background: c.bg, color: c.fg, borderColor: c.border };
  if (winH1) {
    style.textDecoration = 'underline';
    style.textDecorationColor = '#f87171';
    style.textDecorationThickness = '2px';
    style.textUnderlineOffset = '2px';
  }
  return (
    <span
      className="inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-semibold"
      style={style}
    >
      {name}
    </span>
  );
}

export function TypeBadge({ type }: { type: '20p' | '20p_intl' | '16p' }) {
  const c = LEAGUE_COLOR[type];
  return (
    <span
      className="inline-block rounded-[3px] border px-1.5 py-px text-[11px] font-bold"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
      {type === '20p_intl' ? '20p QT' : type}
    </span>
  );
}

export function ResultTag({ result }: { result: 'W' | 'D' | 'L' }) {
  const map = {
    W: 'bg-[#14532d] text-[#4ade80]',
    D: 'bg-[#451a03] text-[#fbbf24]',
    L: 'bg-[#450a0a] text-[#f87171]',
  } as const;
  return (
    <span
      className={`rounded px-[7px] py-0.5 text-[11px] font-bold ${map[result]}`}
    >
      {result}
    </span>
  );
}
