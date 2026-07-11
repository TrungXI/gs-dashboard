'use client';

import { useEffect, useRef, useState } from 'react';

interface GsLiveMatch {
  leagueId: number;
  leagueName: string;
  matchType: '16p' | '20p' | '8p' | '12p';
  eventId: number;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  h1Home: number;
  h1Away: number;
  minuteElapsed: number | null;
  secondsElapsed: number | null;
  bettingOpen: boolean;
  isLive: boolean;
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
}

type Signal =
  | { kind: 'FOLLOW'; label: '◀ FOLLOW'; color: string }
  | { kind: 'LOCK'; label: '✓ LOCK'; color: string }
  | { kind: 'TRAP'; label: '⚠ TRAP'; color: string }
  | { kind: 'DRAW_LOCK'; label: '✓ DRAW LOCK'; color: string };

const GREEN = '#4ade80';
const BLUE = '#60a5fa';
const ORANGE = '#fb923c';

// Decimal-odds thresholds mirrored from the Malay thresholds in the spec.
const FOLLOW_DEC_MAX = 1.67;  // < -1.50 Malay  → decimal < 1.67
const LOCK_DEC_MIN = 8.0;     // > +7.0 Malay   → decimal > 8.0
const DRAW_LOCK_DEC_MAX = 1.25; // < -4.0 Malay → decimal < 1.25

function classifySignals(m: GsLiveMatch, prev: GsLiveMatch | undefined): Signal | null {
  const { oddsHome, oddsAway, oddsDraw, h1Home, h1Away } = m;

  // DRAW LOCK: 0-0 and draw odds very short.
  if (h1Home === 0 && h1Away === 0 && oddsDraw != null && oddsDraw < DRAW_LOCK_DEC_MAX) {
    return { kind: 'DRAW_LOCK', label: '✓ DRAW LOCK', color: BLUE };
  }

  // TRAP: score is not 0-0, time still remaining, draw odds suspiciously short.
  const timeRemaining = m.bettingOpen; // betting open ⇒ first period underway, time left
  if (
    !(h1Home === 0 && h1Away === 0) &&
    timeRemaining &&
    oddsDraw != null &&
    oddsDraw < 1.67
  ) {
    return { kind: 'TRAP', label: '⚠ TRAP', color: ORANGE };
  }

  // Determine leading team (by current H1 score).
  const leaderIsHome = h1Home > h1Away;
  const leaderIsAway = h1Away > h1Home;

  // LOCK: the opposing team's odds are drifting very long (near-certain lock the other way).
  if (leaderIsHome && oddsAway != null && oddsAway > LOCK_DEC_MIN) {
    return { kind: 'LOCK', label: '✓ LOCK', color: BLUE };
  }
  if (leaderIsAway && oddsHome != null && oddsHome > LOCK_DEC_MIN) {
    return { kind: 'LOCK', label: '✓ LOCK', color: BLUE };
  }

  // FOLLOW: the leading team's odds are shortening AND already < 1.67 decimal.
  if (prev) {
    if (
      leaderIsHome &&
      oddsHome != null &&
      prev.oddsHome != null &&
      oddsHome < prev.oddsHome &&
      oddsHome < FOLLOW_DEC_MAX
    ) {
      return { kind: 'FOLLOW', label: '◀ FOLLOW', color: GREEN };
    }
    if (
      leaderIsAway &&
      oddsAway != null &&
      prev.oddsAway != null &&
      oddsAway < prev.oddsAway &&
      oddsAway < FOLLOW_DEC_MAX
    ) {
      return { kind: 'FOLLOW', label: '◀ FOLLOW', color: GREEN };
    }
  }

  return null;
}

/** Drift arrow between previous and current decimal odds. Shorter (lower) = ↓, longer = ↑. */
function Drift({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur == null || prev == null) return null;
  const delta = cur - prev;
  if (Math.abs(delta) < 0.005) return null;
  const shorter = delta < 0;
  return (
    <span className={shorter ? 'text-[#4ade80]' : 'text-[#f87171]'}>
      {shorter ? '↓' : '↑'}
      {Math.abs(delta).toFixed(2)}
    </span>
  );
}

function OddsCell({
  malay,
  cur,
  prev,
}: {
  malay: string | null;
  cur: number | null;
  prev: number | null | undefined;
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-semibold text-white">{malay ?? '—'}</span>{' '}
      <span className="text-[11px]">
        <Drift cur={cur} prev={prev} />
      </span>
    </span>
  );
}

function phaseLabel(m: GsLiveMatch): string {
  // e-sports report seconds elapsed in the current period.
  if (m.secondsElapsed != null) {
    const half = m.bettingOpen ? 'H1' : 'H2';
    return `${half} +${m.secondsElapsed}s`;
  }
  if (m.minuteElapsed != null) {
    const half = m.bettingOpen ? 'H1' : 'H2';
    return `${half} +${m.minuteElapsed}min`;
  }
  return m.bettingOpen ? 'H1' : 'H2';
}

export default function GSLive() {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Previous poll snapshot keyed by eventId, used to compute drift + FOLLOW signal.
  const prevRef = useRef<Map<number, GsLiveMatch>>(new Map());
  const [prevMap, setPrevMap] = useState<Map<number, GsLiveMatch>>(new Map());

  useEffect(() => {
    let alive = true;

    async function poll() {
      setLoading(true);
      try {
        const token = localStorage.getItem('gs_token') ?? '69-6aed7dc417eb4882d88c6899ae3c0ae1';
        const res = await fetch(`/api/gs-live?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as { ok: boolean; matches?: GsLiveMatch[]; error?: string };
        if (!alive) return;
        if (!json.ok) {
          setError(json.error ?? 'Lỗi tải dữ liệu');
        } else {
          setError(null);
          // Snapshot the previous list before replacing it.
          setPrevMap(new Map(prevRef.current));
          const next = json.matches ?? [];
          prevRef.current = new Map(next.map((m) => [m.eventId, m]));
          setMatches(next);
          setUpdatedAt(new Date().toLocaleTimeString('vi-VN'));
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <div className="mb-5 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🔴 GS Live — Odds Tracker</h1>
        <span className="text-[13px] text-[#666]">{matches.length} trận live</span>
        {loading && <span className="text-[12px] text-[#fbbf24]">Đang cập nhật…</span>}
        {updatedAt && (
          <span className="ml-auto text-[12px] text-[#4ade80]/70">
            ⟳ 10s · {updatedAt}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-[13px] text-[#f87171]">
          {error}
        </div>
      )}

      {matches.length === 0 && !error ? (
        <div className="flex h-[300px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-4 text-5xl">📡</div>
          <div className="text-[15px] text-[#888]">Chưa có trận live. Đang chờ dữ liệu…</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full min-w-[860px] border-collapse bg-[#141414] text-sm">
            <thead>
              <tr>
                {['#', 'Trận đấu', 'Tỉ số', 'Phase', 'Odds (Malay)', 'Tín hiệu'].map((h, i) => (
                  <th
                    key={h}
                    className={`bg-[#1a1a1a] px-2.5 py-2.5 text-xs font-semibold text-[#aaa] ${
                      i === 0 || i === 2 || i === 3 ? 'text-center' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => {
                const prev = prevMap.get(m.eventId);
                const signal = classifySignals(m, prev);
                return (
                  <tr key={m.eventId} className="odd:bg-[#141414] even:bg-[#181818] hover:bg-[#222]">
                    <td className="border-b border-[#222] px-2.5 py-2 text-center text-[11px] text-[#555]">
                      {i + 1}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2">
                      <span className="text-white">{m.homeTeam}</span>
                      <span className="mx-1.5 text-[#555]">vs</span>
                      <span className="text-white">{m.awayTeam}</span>
                      <span className="ml-2 text-[10px] text-[#555]">{m.matchType}</span>
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center font-bold text-[#fbbf24]">
                      {m.h1Home}-{m.h1Away}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center text-xs text-[#888]">
                      {phaseLabel(m)}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-xs">
                      <span className="text-[#888]">H:</span>{' '}
                      <OddsCell malay={m.malayHome} cur={m.oddsHome} prev={prev?.oddsHome} />
                      <span className="mx-1.5 text-[#333]">|</span>
                      <span className="text-[#888]">A:</span>{' '}
                      <OddsCell malay={m.malayAway} cur={m.oddsAway} prev={prev?.oddsAway} />
                      <span className="mx-1.5 text-[#333]">|</span>
                      <span className="text-[#888]">D:</span>{' '}
                      <OddsCell malay={m.malayDraw} cur={m.oddsDraw} prev={prev?.oddsDraw} />
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2">
                      {signal && (
                        <span
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{ color: signal.color, backgroundColor: `${signal.color}22` }}
                        >
                          {signal.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
