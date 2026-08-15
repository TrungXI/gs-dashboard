'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from './Spinner';

// ── Response shape (mirror /api/gs-goal-timeline §6, khoá) ───────────────────
type League = '16p' | '20p_asian' | '20p_intl';
type HalfKey = 'H1' | 'H2';

interface DistBin {
  binStart: number;
  binEnd: number;
  goals: number;
  goalsPerMatch: number;
  sharePct: number;
  occupancy: number;
  atRisk: number;
  ci: [number, number];
}
interface KMPoint {
  minute: number;
  s: number;
  ci: [number, number];
}
interface FirstGoal {
  km: KMPoint[];
  median: number | null;
  denom: number;
}
interface GapStat {
  hist: { gap: number; count: number }[];
  mean: number;
  median: number;
  iqr: [number, number];
  nIntervals: number;
}
interface TransitionResult {
  enabled: boolean;
  reason?: string;
  method: string;
  simulations: number;
  seed: number;
  methodologyVersion: string;
  bins: string[];
  counts: number[][];
  expected: number[][];
  adjustedLift: (number | null)[][];
  pValue: (number | null)[][];
  qValue: (number | null)[][];
  significant: boolean[][];
  expectedMask: boolean[][];
  selfBinDeviation: { bin: string; value: number; p: number }[];
  globalMonteCarloP: number | null;
}
interface GoalTimelineResponse {
  ok: boolean;
  error?: string;
  league: League;
  days: number;
  bin: number;
  methodologyVersion: string;
  generatedAt: string;
  quality: {
    completeMatches: number;
    matchesWithGoal: number;
    matches0_0: number;
    sampleGoals: number;
    excludedInProgress: number;
    reachedH2: number;
    leftCensoredGoals: number;
    intervalCensoredGoalBatches: number;
    undercountEvents: number;
    overflowMinuteGoals: number;
    rarePeriodRows: number;
    unclassified20pEvents: number;
    sourceCoverageStart: string | null;
    sourceCoverageEnd: string | null;
    completeThrough: string | null;
    thin: boolean;
  };
  perHalf: {
    H1: { distribution: DistBin[]; firstGoal: FirstGoal | null };
    H2: { distribution: DistBin[]; firstGoal: FirstGoal | null };
  };
  gapWithinHalf: { H1: GapStat | null; H2: GapStat | null };
  transition: TransitionResult;
  caveats: string[];
}

// ── Palette (match repo dark theme) ──────────────────────────────────────────
const CYAN = '#38bdf8';
const GREEN = '#4ade80';
const RED = '#f87171';
const AMBER = '#fbbf24';
const H1_COLOR = CYAN;
const H2_COLOR = AMBER;

const LEAGUES: [League, string][] = [
  ['16p', '16p'],
  ['20p_asian', '20p Asian'],
  ['20p_intl', '20p Quốc tế'],
];
const DAYS_OPTS = [7, 14];
const BIN_OPTS = [5, 10];

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function pct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

// ── Reusable primitives ──────────────────────────────────────────────────────
function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums text-white leading-none">{value}</div>
      {sub != null && <div className="mt-1 text-[11px] text-[#888]">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[13px] font-semibold text-white">{title}</h3>
        {hint && <span className="text-[11px] text-[#666]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-[#3a3a3a] bg-[#1a1a1a] py-10 px-4 text-center text-[12px] text-[#777]">
      {label}
    </div>
  );
}

// ── Chart wrapper: measures px, draws SVG 1:1 (pattern TxTimelineChart) ───────
function ChartFrame({ height, children }: { height: number; children: (w: number, h: number) => React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(680);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(280, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrapRef} className="w-full">
      <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} className="block select-none">
        {children(w, height)}
      </svg>
    </div>
  );
}

// ── (2) Bar: goals/trận per bin, clustered H1|H2 ─────────────────────────────
function DistributionBars({ h1, h2 }: { h1: DistBin[]; h2: DistBin[] }) {
  const nBins = Math.max(h1.length, h2.length);
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 34;
  const H = 220;
  const maxVal = Math.max(
    0.001,
    ...h1.map((b) => b.goalsPerMatch),
    ...h2.map((b) => b.goalsPerMatch),
  );
  const yTicks = [0, maxVal / 2, maxVal];

  return (
    <ChartFrame height={H}>
      {(W) => {
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;
        const groupW = plotW / nBins;
        const barGap = 3;
        const barW = Math.max(3, (groupW - barGap * 3) / 2);
        const yAt = (v: number) => PAD_T + (1 - v / maxVal) * plotH;
        return (
          <>
            {yTicks.map((v, k) => (
              <g key={k}>
                <line x1={PAD_L} x2={W - PAD_R} y1={yAt(v)} y2={yAt(v)} stroke="#242424" strokeWidth={1} />
                <text x={PAD_L - 6} y={yAt(v) + 4} textAnchor="end" fontSize={10} fill="#888" className="tabular-nums">
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {Array.from({ length: nBins }).map((_, i) => {
              const gx = PAD_L + i * groupW;
              const b1 = h1[i];
              const b2 = h2[i];
              const label = b1 ?? b2;
              const isLast = i === nBins - 1;
              return (
                <g key={i}>
                  {b1 && (
                    <rect
                      x={gx + barGap}
                      y={yAt(b1.goalsPerMatch)}
                      width={barW}
                      height={Math.max(0, PAD_T + plotH - yAt(b1.goalsPerMatch))}
                      fill={H1_COLOR}
                      opacity={0.85}
                      rx={1.5}
                    >
                      <title>{`H1 ${b1.binStart}-${b1.binEnd}': ${b1.goalsPerMatch.toFixed(3)} bàn/trận (${b1.goals} bàn)`}</title>
                    </rect>
                  )}
                  {b2 && (
                    <rect
                      x={gx + barGap * 2 + barW}
                      y={yAt(b2.goalsPerMatch)}
                      width={barW}
                      height={Math.max(0, PAD_T + plotH - yAt(b2.goalsPerMatch))}
                      fill={H2_COLOR}
                      opacity={0.85}
                      rx={1.5}
                    >
                      <title>{`H2 ${b2.binStart}-${b2.binEnd}': ${b2.goalsPerMatch.toFixed(3)} bàn/trận (${b2.goals} bàn)`}</title>
                    </rect>
                  )}
                  {label && (
                    <text
                      x={gx + groupW / 2}
                      y={H - 18}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#888"
                      className="tabular-nums"
                    >
                      {isLast ? `${label.binStart}+` : `${label.binStart}-${label.binEnd}`}
                    </text>
                  )}
                </g>
              );
            })}
            <text x={PAD_L} y={H - 4} fontSize={10} fill="#666">
              phút
            </text>
          </>
        );
      }}
    </ChartFrame>
  );
}

// ── (3) Heatmap H1×H2 occupancy: rows=H1 bin, cols=H2 bin ────────────────────
function OccupancyHeatmap({ h1, h2 }: { h1: DistBin[]; h2: DistBin[] }) {
  // Occupancy per (H1 bin) × (H2 bin) is not a joint metric from the API; the
  // API provides per-half occupancy. We render the two occupancy vectors as a
  // 2-row band so "đậm = cao" reads directly, one row per half.
  const rows: { label: string; bins: DistBin[] }[] = [
    { label: 'H1', bins: h1 },
    { label: 'H2', bins: h2 },
  ];
  const nCols = Math.max(h1.length, h2.length);
  const PAD_L = 30;
  const PAD_T = 4;
  const PAD_B = 24;
  const rowH = 34;
  const H = PAD_T + rows.length * rowH + PAD_B;

  const colorFor = (occ: number) => {
    // dark → bright cyan by occupancy (0..1)
    const a = 0.08 + 0.9 * Math.min(1, occ);
    return `rgba(56,189,248,${a.toFixed(3)})`;
  };

  return (
    <ChartFrame height={H}>
      {(W) => {
        const gridW = W - PAD_L - 8;
        const cellW = gridW / nCols;
        return (
          <>
            {rows.map((r, ri) => {
              const y = PAD_T + ri * rowH;
              return (
                <g key={r.label}>
                  <text x={PAD_L - 8} y={y + rowH / 2 + 4} textAnchor="end" fontSize={11} fill="#aaa" fontWeight={600}>
                    {r.label}
                  </text>
                  {Array.from({ length: nCols }).map((_, ci) => {
                    const b = r.bins[ci];
                    const occ = b ? b.occupancy : 0;
                    return (
                      <rect
                        key={ci}
                        x={PAD_L + ci * cellW + 1}
                        y={y + 1}
                        width={Math.max(1, cellW - 2)}
                        height={rowH - 2}
                        fill={colorFor(occ)}
                        stroke="#2a2a2a"
                        strokeWidth={0.5}
                        rx={2}
                      >
                        {b && (
                          <title>{`${r.label} ${b.binStart}-${b.binEnd}': ${pct(occ)} trận có ≥1 bàn`}</title>
                        )}
                      </rect>
                    );
                  })}
                </g>
              );
            })}
            {Array.from({ length: nCols }).map((_, ci) => {
              const b = h1[ci] ?? h2[ci];
              if (!b) return null;
              const isLast = ci === nCols - 1;
              const cellW = gridW / nCols;
              return (
                <text
                  key={ci}
                  x={PAD_L + ci * cellW + cellW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#888"
                  className="tabular-nums"
                >
                  {isLast ? `${b.binStart}+` : `${b.binStart}-${b.binEnd}`}
                </text>
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ── (4) First-goal KM survival curve ─────────────────────────────────────────
function KMCurve({ h1, h2 }: { h1: FirstGoal | null; h2: FirstGoal | null }) {
  const series: { fg: FirstGoal; color: string; label: string }[] = [];
  if (h1) series.push({ fg: h1, color: H1_COLOR, label: 'H1' });
  if (h2) series.push({ fg: h2, color: H2_COLOR, label: 'H2' });

  const maxMinute = Math.max(
    1,
    ...series.flatMap((s) => s.fg.km.map((p) => p.minute)),
  );
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 28;
  const H = 240;

  return (
    <ChartFrame height={H}>
      {(W) => {
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;
        const xAt = (m: number) => PAD_L + (m / maxMinute) * plotW;
        const yAt = (s: number) => PAD_T + (1 - s) * plotH;
        return (
          <>
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={yAt(v)}
                  y2={yAt(v)}
                  stroke={v === 0.5 ? '#3a3a3a' : '#242424'}
                  strokeWidth={1}
                  strokeDasharray={v === 0.5 ? '3 4' : '0'}
                />
                <text x={PAD_L - 6} y={yAt(v) + 4} textAnchor="end" fontSize={10} fill="#888" className="tabular-nums">
                  {pct(v)}
                </text>
              </g>
            ))}
            {[10, 20, 30, 40, 50]
              .filter((m) => m <= maxMinute)
              .map((m) => (
                <text key={m} x={xAt(m)} y={H - 10} textAnchor="middle" fontSize={10} fill="#888" className="tabular-nums">
                  {m}′
                </text>
              ))}
            {series.map((s) => {
              const pts = s.fg.km.map((p) => `${xAt(p.minute).toFixed(1)},${yAt(p.s).toFixed(1)}`).join(' ');
              return (
                <polyline key={s.label} points={pts} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />
              );
            })}
          </>
        );
      }}
    </ChartFrame>
  );
}

// ── (5) Gap histogram within-half ────────────────────────────────────────────
function GapHistogram({ gap, color, label }: { gap: GapStat; color: string; label: string }) {
  const bars = gap.hist;
  const maxCount = Math.max(1, ...bars.map((b) => b.count));
  const PAD_L = 34;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 26;
  const H = 180;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[11px] text-[#888]">
        <span className="font-semibold" style={{ color }}>
          {label}
        </span>
        <span className="tabular-nums">
          trung bình <span className="text-white">{gap.mean.toFixed(1)}′</span>
        </span>
        <span className="tabular-nums">
          median <span className="text-white">{gap.median.toFixed(1)}′</span>
        </span>
        <span className="tabular-nums">
          IQR <span className="text-white">{gap.iqr[0].toFixed(0)}–{gap.iqr[1].toFixed(0)}′</span>
        </span>
        <span className="text-[#666]">· {gap.nIntervals} khoảng</span>
      </div>
      <ChartFrame height={H}>
        {(W) => {
          const plotW = W - PAD_L - PAD_R;
          const plotH = H - PAD_T - PAD_B;
          const n = bars.length;
          const barW = n > 0 ? plotW / n : plotW;
          const yAt = (v: number) => PAD_T + (1 - v / maxCount) * plotH;
          return (
            <>
              <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#2a2a2a" strokeWidth={1} />
              {bars.map((b, i) => {
                const bx = PAD_L + i * barW;
                return (
                  <g key={i}>
                    <rect
                      x={bx + 1}
                      y={yAt(b.count)}
                      width={Math.max(1, barW - 2)}
                      height={Math.max(0, PAD_T + plotH - yAt(b.count))}
                      fill={color}
                      opacity={0.8}
                      rx={1.5}
                    >
                      <title>{`gap ${b.gap}′: ${b.count} khoảng`}</title>
                    </rect>
                    {(n <= 12 || i % 2 === 0) && (
                      <text x={bx + barW / 2} y={H - 10} textAnchor="middle" fontSize={9} fill="#777" className="tabular-nums">
                        {b.gap}
                      </text>
                    )}
                  </g>
                );
              })}
              <text x={PAD_L} y={H - 1} fontSize={9} fill="#666">
                gap (phút)
              </text>
            </>
          );
        }}
      </ChartFrame>
    </div>
  );
}

// ── (6) Transition heatmap: color by adjustedLift, marker if significant ──────
function TransitionHeatmap({ t }: { t: TransitionResult }) {
  const labels = t.bins;
  const dim = labels.length;
  const CELL = 30;
  const PAD_L = 66;
  const PAD_T = 66;
  const W = PAD_L + dim * CELL + 10;
  const H = PAD_T + dim * CELL + 10;

  // color: lift<1 blue (giảm), lift>1 red (tăng), 1 = neutral grey
  const colorFor = (lift: number | null, masked: boolean) => {
    if (masked || lift === null) return '#232323';
    if (lift >= 1) {
      const a = Math.min(1, (lift - 1) / 1.5);
      return `rgba(248,113,113,${(0.12 + 0.85 * a).toFixed(3)})`;
    }
    const a = Math.min(1, (1 - lift) / 1);
    return `rgba(56,189,248,${(0.12 + 0.85 * a).toFixed(3)})`;
  };

  const short = (l: string) => l; // 'H1:1-5'

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block select-none">
        {/* column labels (B, sau) */}
        {labels.map((l, j) => (
          <text
            key={`c${j}`}
            x={PAD_L + j * CELL + CELL / 2}
            y={PAD_T - 6}
            textAnchor="start"
            fontSize={9}
            fill="#999"
            transform={`rotate(-55 ${PAD_L + j * CELL + CELL / 2} ${PAD_T - 6})`}
          >
            {short(l)}
          </text>
        ))}
        {/* row labels (A, trước) */}
        {labels.map((l, i) => (
          <text key={`r${i}`} x={PAD_L - 6} y={PAD_T + i * CELL + CELL / 2 + 3} textAnchor="end" fontSize={9} fill="#999">
            {short(l)}
          </text>
        ))}
        <text x={4} y={PAD_T - 6} fontSize={9} fill="#666">
          A↓ B→
        </text>
        {labels.map((_, i) =>
          labels.map((__, j) => {
            const lift = t.adjustedLift[i][j];
            const masked = t.expectedMask[i][j];
            const sig = t.significant[i][j];
            const x = PAD_L + j * CELL;
            const y = PAD_T + i * CELL;
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL - 2}
                  height={CELL - 2}
                  fill={colorFor(lift, masked)}
                  stroke={sig ? '#fff' : '#1e1e1e'}
                  strokeWidth={sig ? 1.6 : 0.5}
                  rx={2}
                >
                  <title>
                    {`${labels[i]} → ${labels[j]}\n` +
                      `quan sát ${t.counts[i][j]}, kỳ vọng ${t.expected[i][j].toFixed(1)}\n` +
                      `lift ${lift === null ? '—' : lift.toFixed(2)}` +
                      (masked ? ' (kỳ vọng <5, ẩn)' : '') +
                      (sig ? ' · CÓ Ý NGHĨA (q<0.05)' : '')}
                  </title>
                </rect>
                {sig && (
                  <text x={x + CELL / 2} y={y + CELL / 2 + 3.5} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>
                    ✷
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

// ── One league tab body ──────────────────────────────────────────────────────
function LeagueBody({ data }: { data: GoalTimelineResponse }) {
  const q = data.quality;
  const t = data.transition;
  const gap = data.gapWithinHalf;
  const fgH1 = data.perHalf.H1.firstGoal;
  const fgH2 = data.perHalf.H2.firstGoal;

  return (
    <div className="flex flex-col gap-4">
      {/* (1) quality badges */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Trận hoàn tất" value={q.completeMatches.toLocaleString()} sub={`chạm H2: ${q.reachedH2.toLocaleString()}`} />
        <Card
          label="Trận 0-0"
          value={q.matches0_0.toLocaleString()}
          sub={q.completeMatches > 0 ? pct1(q.matches0_0 / q.completeMatches) : '—'}
        />
        <Card label="Tổng bàn mẫu" value={q.sampleGoals.toLocaleString()} sub={`có bàn: ${q.matchesWithGoal.toLocaleString()}`} />
        <Card
          label="Cửa sổ nguồn"
          value={q.completeMatches > 0 ? `${data.days}d` : '—'}
          sub={q.leftCensoredGoals + q.intervalCensoredGoalBatches > 0 ? `censored ${q.leftCensoredGoals}L/${q.intervalCensoredGoalBatches}I` : 'sạch'}
        />
      </div>

      {q.thin && (
        <div className="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-3 py-2 text-[12px] text-[#fbbf24]">
          ⚠️ Đang tích dữ liệu — mẫu mỏng. Số liệu dưới đây có thể không ổn định; chỉ tham khảo định hướng.
        </div>
      )}

      {/* (2) distribution bars */}
      <Section title="Bàn/trận theo phút" hint="cụm H1 (xanh) · H2 (vàng), theo bin phút">
        <DistributionBars h1={data.perHalf.H1.distribution} h2={data.perHalf.H2.distribution} />
      </Section>

      {/* (3) occupancy heatmap */}
      <Section title="Tỉ lệ trận có bàn theo bin (occupancy)" hint="đậm = nhiều trận ghi bàn trong bin đó">
        <OccupancyHeatmap h1={data.perHalf.H1.distribution} h2={data.perHalf.H2.distribution} />
      </Section>

      {/* (4) first-goal KM */}
      <Section title="Bàn đầu tiên — đường sống sót (KM)" hint="S(t) = % trận CHƯA ghi bàn tính đến phút t">
        {fgH1 || fgH2 ? (
          <>
            <KMCurve h1={fgH1} h2={fgH2} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#888]">
              {fgH1 && (
                <span>
                  <span style={{ color: H1_COLOR }}>■</span> H1 median{' '}
                  <span className="text-white tabular-nums">{fgH1.median === null ? '—' : `${fgH1.median}′`}</span> (n={fgH1.denom})
                </span>
              )}
              {fgH2 && (
                <span>
                  <span style={{ color: H2_COLOR }}>■</span> H2 median{' '}
                  <span className="text-white tabular-nums">{fgH2.median === null ? '—' : `${fgH2.median}′`}</span> (n={fgH2.denom})
                </span>
              )}
            </div>
          </>
        ) : (
          <EmptyState label="Chưa đủ dữ liệu cho đường sống sót bàn đầu — cần ≥100 trận hoàn tất mỗi hiệp." />
        )}
      </Section>

      {/* (5) gap histogram */}
      <Section title="Khoảng cách giữa 2 bàn liên tiếp (within-half)" hint="chỉ tính cặp bàn trong cùng một hiệp">
        {gap.H1 || gap.H2 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {gap.H1 ? <GapHistogram gap={gap.H1} color={H1_COLOR} label="H1" /> : <EmptyState label="H1: cần ≥150 khoảng." />}
            {gap.H2 ? <GapHistogram gap={gap.H2} color={H2_COLOR} label="H2" /> : <EmptyState label="H2: cần ≥150 khoảng." />}
          </div>
        ) : (
          <EmptyState label="Chưa đủ dữ liệu cho phân bố khoảng cách — cần ≥150 khoảng mỗi hiệp." />
        )}
      </Section>

      {/* (6) transition heatmap */}
      <Section
        title="Ma trận chuyển tiếp bin→bin (within-half)"
        hint="màu theo adjusted lift · ✷ = có ý nghĩa (q<0.05) · ô xám = kỳ vọng <5"
      >
        {t.enabled ? (
          <>
            <TransitionHeatmap t={t} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#888]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'rgba(56,189,248,0.7)' }} /> lift &lt; 1 (ít hơn)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'rgba(248,113,113,0.7)' }} /> lift &gt; 1 (nhiều hơn)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-white">✷</span> q &lt; 0.05
              </span>
              {t.globalMonteCarloP !== null && (
                <span className="tabular-nums">
                  global MC p = <span className="text-white">{t.globalMonteCarloP.toFixed(3)}</span>
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#666]">
              adjusted lift — <span className="text-[#888]">mô tả</span>, KHÔNG nhân quả. Null model ={' '}
              {t.method} ({t.simulations} sims, seed {t.seed}).
            </p>
          </>
        ) : (
          <EmptyState label={`Ma trận chuyển tiếp chưa bật — ${t.reason ?? 'chưa đủ mẫu'}.`} />
        )}
      </Section>

      {/* caveats */}
      {data.caveats.length > 0 && (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#666]">Lưu ý phương pháp</div>
          <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-[#888]">
            {data.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function GoalTimeline() {
  const [league, setLeague] = useState<League>('16p');
  const [days, setDays] = useState(14);
  const [bin, setBin] = useState(5);
  const [data, setData] = useState<GoalTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (lg: League, d: number, b: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gs-goal-timeline?league=${lg}&days=${d}&bin=${b}`, { cache: 'no-store' });
      const json = (await res.json()) as GoalTimelineResponse;
      if (!json.ok) throw new Error(json.error || 'Lỗi tải Timeline Ghi Bàn');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(league, days, bin);
  }, [league, days, bin, load]);

  const chooseLeague = (lg: League) => {
    setLeague(lg);
  };

  const pill = (active: boolean) =>
    `rounded px-2.5 py-1 text-[12px] border transition-colors ${
      active
        ? 'border-[#38bdf8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20'
        : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'
    }`;

  const leagueLabel = useMemo(() => LEAGUES.find(([v]) => v === league)?.[1] ?? league, [league]);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4 max-md:pb-20">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-[16px] font-bold text-white">⏱️ Timeline Ghi Bàn</h2>
        {loading && <Spinner size={13} />}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* league chip-tabs */}
          <div className="flex items-center gap-1">
            {LEAGUES.map(([v, label]) => (
              <button key={v} type="button" onClick={() => chooseLeague(v)} className={pill(league === v)} title={`Giải ${label}`}>
                {label}
              </button>
            ))}
          </div>
          {/* days */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#666]">Ngày</span>
            {DAYS_OPTS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={pill(days === d)}>
                {d}
              </button>
            ))}
          </div>
          {/* bin */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[#666]">Bin</span>
            {BIN_OPTS.map((b) => (
              <button key={b} type="button" onClick={() => setBin(b)} className={pill(bin === b)}>
                {b}′
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">{error}</div>
      )}

      {!error && data && (
        <>
          <div className="text-[11px] text-[#666]">
            {leagueLabel} · {data.days} ngày · bin {data.bin}′ · {data.methodologyVersion}
          </div>
          <LeagueBody data={data} />
        </>
      )}

      {!error && !data && loading && (
        <div className="flex items-center justify-center py-20 text-[13px] text-[#888]">
          <Spinner size={16} /> <span className="ml-2">Đang tải dữ liệu…</span>
        </div>
      )}
    </div>
  );
}
