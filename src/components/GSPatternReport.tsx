'use client';

import { useMemo } from 'react';
import type { Match } from '../types/match';
import {
  scorePatterns,
  rollingHomeWin,
  typeComparison,
  scoringStreaks,
  timeOfDay,
  type TypeAgg,
  type SlotAgg,
} from '../lib/gsPatterns';

const CARD = 'overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]';
const TITLE = 'bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white border-b border-[#2a2a2a]';

const H1_GROUPS_SHOWN = 8;
const SPARK_W = 600;
const SPARK_H = 100;

export default function GSPatternReport({ matches }: { matches: Match[] }) {
  const patterns = useMemo(() => scorePatterns(matches), [matches]);
  const rolling = useMemo(() => rollingHomeWin(matches), [matches]);
  const types = useMemo(() => typeComparison(matches), [matches]);
  const scoring = useMemo(() => scoringStreaks(matches), [matches]);
  const slots = useMemo(() => timeOfDay(matches), [matches]);

  if (matches.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#555]">
        Không có dữ liệu
      </div>
    );
  }

  const topSlot = slots.reduce<SlotAgg | null>(
    (best, s) => (s.n > 0 && (!best || s.homeWinPct > best.homeWinPct) ? s : best),
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Card 1 — Score pattern sequences (H1 → TT) */}
      <div className={CARD}>
        <div className={TITLE}>🎯 Mẫu tỉ số: H1 → Kết thúc</div>
        <div className="flex flex-col gap-4 p-4">
          {patterns.length === 0 ? (
            <p className="text-[12px] text-[#555]">Chưa đủ dữ liệu (cần ≥3 trận mỗi tỉ số H1).</p>
          ) : (
            patterns.slice(0, H1_GROUPS_SHOWN).map((g) => {
              const maxPct = g.outcomes[0]?.pct ?? 0;
              return (
                <div key={g.h1Score}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-[#fbbf24]">H1 = {g.h1Score}</span>
                    <span className="text-[12px] text-[#666]">{g.total} trận</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.outcomes.map((o) => (
                      <div
                        key={o.ttScore}
                        className={`rounded-md border px-2.5 py-1.5 ${
                          o.pct === maxPct
                            ? 'border-[#22d3ee]/50 bg-[#1e1e1e]'
                            : 'border-[#2a2a2a] bg-[#181818]'
                        }`}
                      >
                        <div className="text-[11px] font-semibold text-[#ddd]">
                          TT {o.ttScore}: {o.pct}%{' '}
                          <span className="font-normal text-[#666]">({o.count})</span>
                        </div>
                        <div className="mt-1 h-[6px] w-full overflow-hidden rounded bg-[#2a2a2a]">
                          <div className="h-full bg-[#22d3ee]" style={{ width: `${o.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Card 2 — Rolling home-win window */}
      <div className={CARD}>
        <div className={TITLE}>📈 Tỉ lệ Home win — cửa sổ trượt 20 trận</div>
        <div className="p-4">
          {rolling.points.length === 0 ? (
            <p className="text-[12px] text-[#555]">Cần ≥20 trận để tính cửa sổ trượt.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
                <span className="text-[#aaa]">
                  Đầu kỳ <span className="font-semibold text-white">{rolling.firstPct}%</span> → Cuối kỳ{' '}
                  <span className="font-semibold text-white">{rolling.lastPct}%</span>
                </span>
                <TrendPill trend={rolling.trend} />
                <span className="text-[12px] text-[#666]">{rolling.points.length} điểm</span>
              </div>
              <div className="h-[120px] w-full rounded bg-[#1e1e1e] p-2">
                <Sparkline points={rolling.points.map((p) => p.homeWinPct)} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Card 3 — Match type comparison */}
      <div className={CARD}>
        <div className={TITLE}>⚔️ 20p vs 16p</div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TypePanel agg={types.p20} label="20 phút" />
            <TypePanel agg={types.p16} label="16 phút" />
          </div>
          <div className="mt-3 text-[12px] text-[#888]">
            Home win cao hơn ở loại{' '}
            <span className="font-semibold text-[#4ade80]">
              {types.p20.homeWinPct >= types.p16.homeWinPct ? '20p' : '16p'}
            </span>{' '}
            ({types.p20.homeWinPct}% vs {types.p16.homeWinPct}%)
          </div>
        </div>
      </div>

      {/* Card 4 — High/low scoring streaks */}
      <div className={CARD}>
        <div className={TITLE}>🔥 Chuỗi nhiều/ít bàn</div>
        <div className="p-4">
          <div className="mb-3 text-[12px] text-[#888]">
            Ngưỡng: {scoring.threshold} bàn (trung vị)
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-[#1e1e1e] px-3.5 py-3">
              <div className="text-[12px] font-bold text-[#f87171]">
                🔥 Nhiều bàn (≥{scoring.threshold})
              </div>
              <div className="mt-1 text-[13px] text-[#ddd]">
                {scoring.high.count} trận · {scoring.high.pct}% · TB {scoring.high.avgGoals}
              </div>
            </div>
            <div className="rounded-lg bg-[#1e1e1e] px-3.5 py-3">
              <div className="text-[12px] font-bold text-[#22d3ee]">
                ❄️ Ít bàn (&lt;{scoring.threshold})
              </div>
              <div className="mt-1 text-[13px] text-[#ddd]">
                {scoring.low.count} trận · {scoring.low.pct}% · TB {scoring.low.avgGoals}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[12px] text-[#888]">
            Chuỗi dài nhất: Nhiều bàn {scoring.longestHighStreak} · Ít bàn {scoring.longestLowStreak}
            {scoring.currentStreakType && (
              <span className="text-[#fbbf24]">
                {' '}— hiện tại: {scoring.currentStreakType === 'high' ? 'Nhiều' : 'Ít'} bàn ×
                {scoring.currentStreakLength}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Card 5 — Time of day */}
      <div className={CARD}>
        <div className={TITLE}>🕐 Mẫu theo khung giờ</div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {slots.map((s) => (
              <SlotPanel key={s.slot} slot={s} />
            ))}
          </div>
          {topSlot && (
            <div className="mt-3 text-[12px] text-[#888]">
              Khung giờ nhiều Home win nhất:{' '}
              <span className="font-semibold text-[#4ade80]">{topSlot.label}</span> ({topSlot.homeWinPct}%)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrendPill({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  const map = {
    up: { label: '↗︎ Tăng', cls: 'bg-[#4ade80]/15 text-[#4ade80]' },
    down: { label: '↘︎ Giảm', cls: 'bg-[#f87171]/15 text-[#f87171]' },
    flat: { label: '→ Ổn định', cls: 'bg-[#fbbf24]/15 text-[#fbbf24]' },
  } as const;
  const { label, cls } = map[trend];
  return <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${cls}`}>{label}</span>;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  const n = points.length;
  const coords = points.map((p, i) => {
    const x = n === 1 ? SPARK_W / 2 : (i / (n - 1)) * SPARK_W;
    const y = SPARK_H - (p / 100) * SPARK_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[n - 1];
  const lastX = n === 1 ? SPARK_W / 2 : SPARK_W;
  const lastY = SPARK_H - (last / 100) * SPARK_H;

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="h-full w-full"
    >
      {/* 50% reference line */}
      <line
        x1={0}
        y1={SPARK_H / 2}
        x2={SPARK_W}
        y2={SPARK_H / 2}
        stroke="#3f3f46"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <polyline points={coords.join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2} />
      <circle cx={lastX} cy={lastY} r={3} fill="#fbbf24" />
    </svg>
  );
}

function TypePanel({ agg, label }: { agg: TypeAgg; label: string }) {
  const Row = ({ k, v, cls }: { k: string; v: string; cls?: string }) => (
    <div className="flex items-center justify-between border-b border-[#2a2a2a] py-1.5 last:border-b-0">
      <span className="text-[12px] text-[#888]">{k}</span>
      <span className={`text-[12px] font-semibold ${cls ?? 'text-[#ddd]'}`}>{v}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
      <div className="mb-2 inline-block rounded-md bg-[#17a2b8]/20 px-2 py-0.5 text-[12px] font-bold text-[#17a2b8]">
        {label}
      </div>
      <Row k="Trận n" v={String(agg.n)} cls="text-white" />
      <Row k="Home win %" v={`${agg.homeWinPct}% (${agg.homeWins})`} cls="text-[#4ade80]" />
      <Row k="Hòa %" v={`${agg.drawPct}%`} cls="text-[#fbbf24]" />
      <Row k="Away win %" v={`${agg.awayWinPct}%`} cls="text-[#f87171]" />
      <Row k="TB bàn/trận" v={String(agg.avgGoals)} cls="text-[#22d3ee]" />
      <Row k="TB bàn H1" v={String(agg.avgH1Goals)} />
    </div>
  );
}

function SlotPanel({ slot }: { slot: SlotAgg }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-bold text-white">{slot.label}</span>
        <span className="text-[12px] text-[#666]">{slot.n} trận</span>
      </div>
      <div className="mb-2">
        <div className="mb-1 text-[11px] text-[#888]">
          Home win <span className="font-semibold text-[#4ade80]">{slot.homeWinPct}%</span>
        </div>
        <div className="h-[6px] w-full overflow-hidden rounded bg-[#2a2a2a]">
          <div className="h-full bg-[#16a34a]" style={{ width: `${slot.homeWinPct}%` }} />
        </div>
      </div>
      <div className="mb-2">
        <div className="mb-1 text-[11px] text-[#888]">
          Upset (Away) <span className="font-semibold text-[#f87171]">{slot.upsetPct}%</span>
        </div>
        <div className="h-[6px] w-full overflow-hidden rounded bg-[#2a2a2a]">
          <div className="h-full bg-[#dc2626]" style={{ width: `${slot.upsetPct}%` }} />
        </div>
      </div>
      <div className="text-[11px] text-[#888]">
        TB bàn <span className="font-semibold text-[#22d3ee]">{slot.avgGoals}</span>
      </div>
    </div>
  );
}
