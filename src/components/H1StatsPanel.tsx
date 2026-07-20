'use client';

import type { GsBetStats } from '../app/api/gs-bets/route';

// Vòng tròn % kiểu bảng chỉ số trong game. Ring sáng màu đội khi bên đó cao hơn (home xanh / away đỏ).
export function StatDonut({ label, value, higher, side }: { label: string; value: number | null; higher: boolean; side: 'home' | 'away' }) {
  const pct = value == null ? null : Math.max(0, Math.min(100, value));
  const R = 26;
  const C = 2 * Math.PI * R;
  const dash = pct == null ? 0 : (pct / 100) * C;
  const accent = side === 'home' ? '#4ade80' : '#f87171';
  const ring = higher ? accent : '#3f3f46';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[52px] w-[52px] md:h-[62px] md:w-[62px]">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#242424" strokeWidth="5" />
          {pct != null && (
            <circle cx="32" cy="32" r={R} fill="none" stroke={ring} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] md:text-[13px] font-extrabold tabular-nums text-white">
          {pct == null ? '—' : `${Math.round(pct)}%`}
        </div>
      </div>
      <div className="text-center text-[7px] md:text-[8px] font-bold uppercase leading-tight tracking-wide text-[#777]">{label}</div>
    </div>
  );
}

/**
 * Panel chỉ số Hiệp 1 — dùng chung cho tab Kèo (GSLive) và drawer "Chi tiết trận" (BetStatsView).
 * Render đúng cái card chỉ số H1: [3 donut home] [list giữa] [3 donut away] + note stats_partial.
 * Trả về empty-state "chưa đọc được chỉ số" khi stats == null.
 */
export default function H1StatsPanel({
  stats,
  homeName,
  awayName,
}: {
  stats: GsBetStats | null;
  homeName: string;
  awayName: string;
}) {
  if (!stats) {
    return (
      <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/[.06] px-3 py-2 text-[12px] text-[#fbbf24]">
        ⚠️ Chưa đọc được chỉ số từ ảnh H1
      </div>
    );
  }

  // Chỉ số H1 — tên field & thứ tự y hệt bảng SUMMARY trong game
  type StatRow = [string, string | number | null, string | number | null];
  // 3 vòng tròn % (cột dọc mỗi đội)
  const donutRows: StatRow[] = [
    ['DRIBBLE SUCCESS RATE', stats.home_dribble_acc ?? null, stats.away_dribble_acc ?? null],
    ['SHOT ACCURACY', stats.home_shot_acc ?? null, stats.away_shot_acc ?? null],
    ['PASS ACCURACY', stats.home_pass_acc ?? null, stats.away_pass_acc ?? null],
  ];
  // list giữa — giữ đúng field + vị trí như game (field chưa đọc được hiện "—")
  const statRows: StatRow[] = [
    ['Possession %', stats.home_poss, stats.away_poss],
    ['Shots', stats.home_shots, stats.away_shots],
    ['Expected Goals', stats.home_xg, stats.away_xg],
    ['Passes', stats.home_passes, stats.away_passes],
    ['Tackles', stats.home_tackles, stats.away_tackles],
    ['Tackles Won', stats.home_tackles_won, stats.away_tackles_won],
    ['Interceptions', stats.home_interceptions, stats.away_interceptions],
    ['Saves', stats.home_saves, stats.away_saves],
    ['Fouls Committed', stats.home_fouls, stats.away_fouls],
    ['Offsides', stats.home_offsides, stats.away_offsides],
    ['Corners', stats.home_corners, stats.away_corners],
    ['Free Kicks', stats.home_free_kicks, stats.away_free_kicks],
    ['Penalty Kicks', stats.home_penalties, stats.away_penalties],
    ['Yellow Cards', stats.home_yellow, stats.away_yellow],
    ['Red Cards', stats.home_red, stats.away_red],
  ];

  const numeric = (v: string | number | null): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden">
      <div className="flex items-center px-3 py-1.5 text-[10px] font-bold text-[#888] border-b border-[#222]">
        <span className="flex-1 text-left truncate text-[#4ade80]">{stats.home_team ?? homeName}</span>
        <span className="px-2 text-center text-[#555]">Chỉ số</span>
        <span className="flex-1 text-right truncate text-[#f87171]">{stats.away_team ?? awayName}</span>
      </div>
      {stats.stats_partial && (
        <div className="px-3 py-1.5 text-[11px] leading-snug text-[#fbbf24] border-b border-[#222] bg-[#f59e0b]/[.06]">
          ⚠️ Ảnh đọc thiếu vài chỉ số
          {stats.notes && <span className="text-[#b58a3a]"> · {stats.notes}</span>}
        </div>
      )}
      {/* Body kiểu game: [3 donut home] [list giữa] [3 donut away] */}
      <div className="grid grid-cols-[52px_1fr_52px] md:grid-cols-[68px_1fr_68px] gap-1 md:gap-2 px-1.5 md:px-2 py-2">
        {/* donut cột trái = home — dàn đều dọc theo list */}
        <div className="flex flex-col justify-between items-center py-2">
          {donutRows.map(([label, h, a], i) => {
            const hn = numeric(h), an = numeric(a);
            return <StatDonut key={i} label={label} value={hn} side="home" higher={hn != null && an != null && hn > an} />;
          })}
        </div>
        {/* list giữa — mỗi dòng cao đều nhau */}
        <div className="flex flex-col self-stretch min-w-0">
          {statRows.map(([label, h, a], i) => {
            const hn = numeric(h), an = numeric(a);
            const hHi = hn != null && an != null && hn > an;
            const aHi = hn != null && an != null && an > hn;
            return (
              <div key={i} className="flex flex-1 items-center gap-1 min-h-[26px] text-[12px] border-b border-[#1a1a1a]/60 last:border-0">
                <span className={`w-[34px] md:w-[46px] shrink-0 text-left tabular-nums font-semibold border-l-2 pl-1.5 ${hHi ? 'border-[#4ade80] text-[#4ade80]' : 'border-transparent text-[#bbb]'}`}>{h ?? '—'}</span>
                <span className="flex-1 min-w-0 text-center text-[9px] md:text-[10px] leading-tight text-[#888] truncate">{label}</span>
                <span className={`w-[34px] md:w-[46px] shrink-0 text-right tabular-nums font-semibold border-r-2 pr-1.5 ${aHi ? 'border-[#f87171] text-[#f87171]' : 'border-transparent text-[#bbb]'}`}>{a ?? '—'}</span>
              </div>
            );
          })}
        </div>
        {/* donut cột phải = away */}
        <div className="flex flex-col justify-between items-center py-2">
          {donutRows.map(([label, h, a], i) => {
            const hn = numeric(h), an = numeric(a);
            return <StatDonut key={i} label={label} value={an} side="away" higher={hn != null && an != null && an > hn} />;
          })}
        </div>
      </div>
    </div>
  );
}
