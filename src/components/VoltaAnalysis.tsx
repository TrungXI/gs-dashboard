'use client';

import { useMemo } from 'react';
import type { VoltaMatch } from '../types/voltaMatch';
import {
  winDistribution,
  sequenceView,
  teamDominance,
  detectAnomaly,
  predictNext,
  segmentByMetaPattern,
  type WinCode,
  type Run,
  type MetaSegment,
  type NextPrediction,
} from '../lib/voltaPatterns';

const CARD = 'overflow-hidden rounded-[10px] border border-[#2a2a2a] bg-[#141414]';
const TITLE = 'bg-[#1a1a1a] px-4 py-3 text-[15px] font-bold text-white border-b border-[#2a2a2a]';
const TH = 'bg-[#1e1e1e] px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#777]';
const TD = 'border-b border-[#2a2a2a] px-2 py-[7px]';

const SEQ_N = 40;

export default function VoltaAnalysis({ matches }: { matches: VoltaMatch[] }) {
  const dist = useMemo(() => winDistribution(matches), [matches]);
  const seq = useMemo(() => sequenceView(matches), [matches]);
  const dominance = useMemo(() => teamDominance(matches), [matches]);
  const anomaly = useMemo(() => detectAnomaly(matches), [matches]);
  const prediction: NextPrediction = useMemo(
    () => predictNext(seq.runs, matches),
    [seq.runs, matches],
  );
  const segments: MetaSegment[] = useMemo(
    () => segmentByMetaPattern(seq.runs),
    [seq.runs],
  );

  if (matches.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-[#555]">
        Không có dữ liệu
      </div>
    );
  }

  const lastCodes = seq.sequence.slice(-SEQ_N);
  const currentInView = seq.currentRun ? Math.min(seq.currentRun.length, lastCodes.length) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Card 1 — Meta-Pattern Detector */}
      <div style={{ background: '#141414' }} className="rounded-xl border border-white/[.06]">
        <div className="border-b border-white/[.06] px-5 py-3 text-[13px] font-bold text-white/80 tracking-wide">
          🎯 Bộ dò Meta-Pattern
        </div>
        <div className="p-4 flex flex-col gap-3">
          {/* Row 1 — current pattern */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[#888]">Mẫu hiện tại:</span>
            <span
              className={`rounded px-2 py-0.5 text-[12px] font-bold ${
                prediction.currentMetaPattern === 'Không đều'
                  ? 'bg-white/[.06] text-[#888]'
                  : 'bg-[#16a34a]/20 text-[#4ade80]'
              }`}
            >
              [{prediction.currentMetaPattern}]
            </span>
            <span className="text-[12px] text-white/50">· {prediction.label}</span>
            <span className="ml-auto text-[11px] text-[#555]">
              Đã kéo dài: {prediction.currentSegmentLength} runs
            </span>
          </div>

          {seq.runs.length < 4 || prediction.confidence === 0 ? (
            <div className="text-[12px] text-[#555]">
              Không đủ dữ liệu để nhận diện mẫu.
            </div>
          ) : (
            <>
              {/* Row 2 — position in cycle */}
              {seq.currentRun && (
                <div className="text-[12px] text-white/70">
                  <span className="text-[#888]">▶ Vị trí chu kỳ: </span>
                  {seq.currentRun.code}×{prediction.nextExpectedRunLength} đang ở run{' '}
                  {seq.currentRun.length}/{prediction.nextExpectedRunLength}{' '}
                  →{' '}
                  {prediction.remainingInRun > 0
                    ? `Còn ${prediction.remainingInRun} trận nữa rồi flip`
                    : 'Đã đủ, sắp flip'}
                </div>
              )}
              {/* Row 3 — prediction */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[#888]">Dự đoán trận tiếp:</span>
                <span
                  className={`rounded px-3 py-1 text-[14px] font-bold ${
                    prediction.nextCode === 'H'
                      ? 'bg-[#16a34a] text-white'
                      : 'bg-[#dc2626] text-white'
                  }`}
                >
                  [{prediction.nextCode}]
                </span>
                <span className="text-[12px] text-[#888]">
                  (độ tin cậy {Math.round(prediction.confidence * 100)}%)
                </span>
              </div>
              {/* Row 4 — reasoning */}
              <div className="text-[11px] text-white/40 italic">{prediction.reasoning}</div>
              {/* Honesty note */}
              <div className="text-[10px] text-[#555] border-t border-white/[.04] pt-2">
                ⚠ Volta gần như ngẫu nhiên — đây là gợi ý dựa trên xu hướng gần đây, không phải
                đảm bảo. Cân nhắc kỹ.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Card 2 — Segment History */}
      <div style={{ background: '#141414' }} className="rounded-xl border border-white/[.06]">
        <div className="border-b border-white/[.06] px-5 py-3 text-[13px] font-bold text-white/80 tracking-wide">
          🧭 Lịch sử Meta-Pattern
        </div>
        <div className="p-4">
          {segments.length === 0 ? (
            <p className="text-[12px] text-[#555]">Chưa đủ dữ liệu.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {segments.map((seg, idx) => {
                const isLast = idx === segments.length - 1;
                const chipLabel = seg.code || 'Không đều';
                let chipCls = 'rounded px-2.5 py-1 text-[11px] font-mono ';
                if (seg.label === 'Không đều') chipCls += 'bg-[#1e1e1e] text-[#888]';
                else if (seg.label.startsWith('Xen kẽ'))
                  chipCls += 'bg-[#22d3ee]/15 text-[#22d3ee]';
                else chipCls += 'bg-[#16a34a]/15 text-[#4ade80]';
                if (isLast) chipCls += ' ring-2 ring-[#fbbf24]';
                return (
                  <span key={idx} className="flex items-center gap-2">
                    {idx > 0 && <span className="text-[#555] text-[11px]">→</span>}
                    <span className={chipCls}>
                      [{chipLabel}: {seg.runCount} runs → {seg.matchCount} trận]
                      {isLast ? ' ← đây' : ''}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Card A — Anomaly banner */}
      <div
        className={`rounded-[10px] px-4 py-3 text-[13px] ${
          anomaly.isAnomaly
            ? 'bg-[#fbbf24]/15 border border-[#fbbf24]/40 text-[#fbbf24]'
            : 'bg-[#1e1e1e] text-[#aaa]'
        }`}
      >
        {anomaly.message}
      </div>

      {/* Card B — Win distribution */}
      <div className={CARD}>
        <div className={TITLE}>⚖️ Phân bố thắng (Home vs Away)</div>
        <div className="p-4">
          <div className="flex h-[26px] overflow-hidden rounded">
            <div
              className="flex items-center justify-center bg-[#d97706] text-[11px] font-bold text-white"
              style={{ width: `${dist.homePct}%` }}
            >
              {dist.homePct >= 12 ? `H ${dist.home} · ${dist.homePct}%` : ''}
            </div>
            <div
              className="flex items-center justify-center bg-[#16a34a] text-[11px] font-bold text-white"
              style={{ width: `${dist.awayPct}%` }}
            >
              {dist.awayPct >= 12 ? `A ${dist.away} · ${dist.awayPct}%` : ''}
            </div>
          </div>
          <div className="mt-2 text-[12px] text-[#666]">{dist.total} trận</div>
        </div>
      </div>

      {/* Card C — Streak sequence viewer */}
      <div className={CARD}>
        <div className={TITLE}>🎨 Chuỗi kết quả (mới nhất bên phải)</div>
        <div className="p-4">
          <div className="flex flex-wrap gap-1">
            {lastCodes.map((code, i) => {
              const inCurrent = i >= lastCodes.length - currentInView;
              return (
                <div
                  key={i}
                  className={`flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-white ${
                    code === 'H' ? 'bg-[#d97706]' : 'bg-[#16a34a]'
                  } ${inCurrent ? 'ring-2 ring-[#fbbf24]' : ''}`}
                >
                  {code}
                </div>
              );
            })}
          </div>
          {seq.currentRun && (
            <div className="mt-2.5 text-[12px] font-semibold text-[#fbbf24]">
              Chuỗi hiện tại: {seq.currentRun.code}×{seq.currentRun.length}
            </div>
          )}
        </div>
      </div>

      {/* Card D — Run pattern distribution by result */}
      <RunPatternCard runs={seq.runs} />

      {/* Card F — Per-team dominance */}
      <div className={CARD}>
        <div className={TITLE}>🏆 Đội thống trị</div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DominanceTable
              heading="🏠 Top Home win%"
              rows={dominance.topHome}
              code="H"
            />
            <DominanceTable
              heading="✈️ Top Away win%"
              rows={dominance.topAway}
              code="A"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DominanceTable({
  heading,
  rows,
  code,
}: {
  heading: string;
  rows: import('../lib/voltaPatterns').TeamDominance[];
  code: WinCode;
}) {
  const isHome = code === 'H';
  return (
    <div>
      <div className="mb-2 text-[12px] font-bold text-[#aaa]">{heading}</div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[#555]">Chưa đủ dữ liệu (cần ≥3 trận)</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Đội', isHome ? 'Trận (home)' : 'Trận (away)', isHome ? 'H%' : 'A%'].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const games = isHome ? r.homeGames : r.awayGames;
              const wins = isHome ? r.homeWins : r.awayWins;
              const winPct = isHome ? r.homeWinPct : r.awayWinPct;
              return (
                <tr key={r.team}>
                  <td className={`${TD} text-[#ddd]`}>{r.team}</td>
                  <td className={`${TD} text-center text-[#888]`}>{games}</td>
                  <td
                    className={`${TD} text-center font-bold ${
                      isHome ? 'text-[#fbbf24]' : 'text-[#4ade80]'
                    }`}
                  >
                    {winPct}%{' '}
                    <span className="font-normal text-[#666]">
                      ({wins}/{games})
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RunPatternCard({ runs }: { runs: Run[] }) {
  // bucket run lengths: 1, 2, 3, 4+
  const LABELS = ['×1', '×2', '×3', '×4+'];
  const bucket = (len: number) => Math.min(len - 1, 3);

  const hBuckets = [0, 0, 0, 0];
  const aBuckets = [0, 0, 0, 0];
  for (const r of runs) {
    if (r.code === 'H') hBuckets[bucket(r.length)]++;
    else aBuckets[bucket(r.length)]++;
  }
  const hTotal = hBuckets.reduce((s, v) => s + v, 0);
  const aTotal = aBuckets.reduce((s, v) => s + v, 0);
  const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  const BAR_H = 'bg-[#d97706]';
  const BAR_A = 'bg-[#16a34a]';

  return (
    <div className={CARD}>
      <div className={TITLE}>📊 Khi ra H hoặc A — mẫu hình chuỗi tiếp theo</div>
      <div className="p-4 grid grid-cols-2 gap-6">
        {/* Home column */}
        <div>
          <div className="mb-3 text-[13px] font-bold text-[#fbbf24]">
            🏠 Home ({hTotal} chuỗi)
          </div>
          <div className="flex flex-col gap-2">
            {LABELS.map((lbl, i) => {
              const count = hBuckets[i];
              const p = pct(count, hTotal);
              return (
                <div key={lbl}>
                  <div className="flex justify-between mb-0.5 text-[11px]">
                    <span className="text-[#ccc] font-mono">H{lbl}</span>
                    <span className="text-[#fbbf24] font-bold">{p}%</span>
                    <span className="text-[#555]">{count} lần</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#2a2a2a] overflow-hidden">
                    <div className={`h-full ${BAR_H} rounded-full`} style={{ width: `${p}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-[#666]">
            TB chuỗi H: <span className="text-[#fbbf24] font-semibold">
              {hTotal === 0 ? '—' : (hBuckets.reduce((s, v, i) => s + v * (i + 1), 0) / hTotal).toFixed(1)}
            </span>
          </div>
        </div>

        {/* Away column */}
        <div>
          <div className="mb-3 text-[13px] font-bold text-[#4ade80]">
            ✈️ Away ({aTotal} chuỗi)
          </div>
          <div className="flex flex-col gap-2">
            {LABELS.map((lbl, i) => {
              const count = aBuckets[i];
              const p = pct(count, aTotal);
              return (
                <div key={lbl}>
                  <div className="flex justify-between mb-0.5 text-[11px]">
                    <span className="text-[#ccc] font-mono">A{lbl}</span>
                    <span className="text-[#4ade80] font-bold">{p}%</span>
                    <span className="text-[#555]">{count} lần</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#2a2a2a] overflow-hidden">
                    <div className={`h-full ${BAR_A} rounded-full`} style={{ width: `${p}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-[#666]">
            TB chuỗi A: <span className="text-[#4ade80] font-semibold">
              {aTotal === 0 ? '—' : (aBuckets.reduce((s, v, i) => s + v * (i + 1), 0) / aTotal).toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
