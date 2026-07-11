import { teamColor } from '../lib/teamColors';

export function TeamBadge({ name }: { name: string }) {
  const c = teamColor(name);
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold"
      style={{ background: c.bg, color: c.fg }}
    >
      {name}
    </span>
  );
}

export function TypeBadge({ type }: { type: '20p' | '16p' }) {
  const cls =
    type === '20p' ? 'bg-[#17a2b8] text-white' : 'bg-[#fd7e14] text-white';
  return (
    <span
      className={`inline-block rounded-[3px] px-1.5 py-px text-[11px] font-bold ${cls}`}
    >
      {type}
    </span>
  );
}

export function ResultTag({ result }: { result: 'W' | 'D' | 'L' }) {
  const map = {
    W: 'bg-[#d4edda] text-[#155724]',
    D: 'bg-[#fff3cd] text-[#856404]',
    L: 'bg-[#f8d7da] text-[#721c24]',
  } as const;
  return (
    <span
      className={`rounded px-[7px] py-0.5 text-[11px] font-bold ${map[result]}`}
    >
      {result}
    </span>
  );
}
