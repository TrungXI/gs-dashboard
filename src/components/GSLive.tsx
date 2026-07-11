'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';

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
  suspended: boolean;
  hcLines: { line: string | null; home: string | null; away: string | null }[];
  hcH1Lines: { line: string | null; home: string | null; away: string | null }[];
  ouLines: { line: string | null; over: string | null; under: string | null }[];
  ouH1Lines: { line: string | null; over: string | null; under: string | null }[];
}

type Signal =
  | { kind: 'FOLLOW'; label: '◀ THEO'; color: string }
  | { kind: 'TRAP'; label: '⚠ BẪY'; color: string }
  | { kind: 'DRAW_LOCK'; label: '✓ CHỐT HÒA'; color: string };

const GREEN = '#4ade80';
const BLUE = '#60a5fa';
const ORANGE = '#fb923c';

// Decimal-odds thresholds mirrored from the Malay thresholds in the spec.
const FOLLOW_DEC_MAX = 1.67;    // < -1.50 Malay  → decimal < 1.67
const DRAW_LOCK_DEC_MAX = 1.25; // < -4.0 Malay → decimal < 1.25

function classifySignals(m: GsLiveMatch, prev: GsLiveMatch | undefined): Signal | null {
  const { oddsHome, oddsAway, oddsDraw, h1Home, h1Away } = m;

  // DRAW LOCK: 0-0 and draw odds very short.
  if (h1Home === 0 && h1Away === 0 && oddsDraw != null && oddsDraw < DRAW_LOCK_DEC_MAX) {
    return { kind: 'DRAW_LOCK', label: '✓ CHỐT HÒA', color: BLUE };
  }

  // TRAP: score is not 0-0, time still remaining, draw odds suspiciously short.
  const timeRemaining = m.bettingOpen; // betting open ⇒ first period underway, time left
  if (
    !(h1Home === 0 && h1Away === 0) &&
    timeRemaining &&
    oddsDraw != null &&
    oddsDraw < 1.67
  ) {
    return { kind: 'TRAP', label: '⚠ BẪY', color: ORANGE };
  }

  // Determine leading team (by current H1 score).
  const leaderIsHome = h1Home > h1Away;
  const leaderIsAway = h1Away > h1Home;

  // FOLLOW: the leading team's odds are shortening AND already < 1.67 decimal.
  if (prev) {
    if (
      leaderIsHome &&
      oddsHome != null &&
      prev.oddsHome != null &&
      oddsHome < prev.oddsHome &&
      oddsHome < FOLLOW_DEC_MAX
    ) {
      return { kind: 'FOLLOW', label: '◀ THEO', color: GREEN };
    }
    if (
      leaderIsAway &&
      oddsAway != null &&
      prev.oddsAway != null &&
      oddsAway < prev.oddsAway &&
      oddsAway < FOLLOW_DEC_MAX
    ) {
      return { kind: 'FOLLOW', label: '◀ THEO', color: GREEN };
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
    <span className="inline-flex items-center gap-0.5">
      <span className="font-semibold text-white">{malay ?? '—'}</span>
      <span className="text-[10px]">
        <Drift cur={cur} prev={prev} />
      </span>
    </span>
  );
}

/** Fixed-width slot: label + value, always same width so columns don't jitter */
function OddsSlot({
  label,
  malay,
  cur,
  prev,
}: {
  label: string;
  malay: string | null;
  cur?: number | null;
  prev?: number | null;
}) {
  return (
    <span className="inline-flex items-center gap-1" style={{ width: 88, flexShrink: 0 }}>
      <span className="text-[10px] text-[#666] w-3">{label}</span>
      <OddsCell malay={malay} cur={cur ?? null} prev={prev ?? null} />
    </span>
  );
}

/** Malay odds already provided as string (for HC / O-U markets). Negative = red. */
function RawVal({ val }: { val: string | null }) {
  if (val == null) return <span className="font-semibold text-[#555] text-xs min-w-[32px] text-right">—</span>;
  const isNeg = val.startsWith('-');
  return (
    <span className={`font-semibold text-xs min-w-[32px] text-right ${isNeg ? 'text-[#f87171]' : 'text-white'}`}>
      {val}
    </span>
  );
}

function phaseLabel(m: GsLiveMatch): string {
  if (m.secondsElapsed != null) {
    const half = m.bettingOpen ? '1H' : '2H';
    return `${half} ${m.secondsElapsed}s`;
  }
  if (m.minuteElapsed != null) {
    const halfMins = m.matchType === '20p' ? 10 : m.matchType === '12p' ? 6 : m.matchType === '8p' ? 4 : 8;
    const min = m.minuteElapsed;
    if (min <= halfMins) return `1H ${min}'`;
    return `2H ${min - halfMins}'`;
  }
  return m.bettingOpen ? '1H' : '2H';
}

export default function GSLive() {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prevRef = useRef<Map<number, GsLiveMatch>>(new Map());
  const [prevMap, setPrevMap] = useState<Map<number, GsLiveMatch>>(new Map());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [streamUrls, setStreamUrls] = useState<Record<number, string>>({});
  const [scoredIds, setScoredIds] = useState<Set<number>>(new Set());

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
          // Detect score changes for flash animation
          const newScored = new Set<number>();
          for (const nm of next) {
            const pm = prevRef.current.get(nm.eventId);
            if (pm && (nm.h1Home !== pm.h1Home || nm.h1Away !== pm.h1Away)) {
              newScored.add(nm.eventId);
            }
          }
          if (newScored.size > 0) {
            setScoredIds(newScored);
            setTimeout(() => setScoredIds(new Set()), 3000);
          }
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
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function fetchStream(eventId: number, leagueId: number) {
    if (streamUrls[eventId]) return;
    try {
      const token = localStorage.getItem('gs_token') ?? GS_STREAM_TOKEN;
      const res = await fetch(
        `/api/gs-stream?eventId=${eventId}&leagueId=${leagueId}&token=${encodeURIComponent(token)}`
      );
      const data = (await res.json()) as { ok: boolean; streamUrl?: string };
      if (data.ok && data.streamUrl) {
        setStreamUrls((prev) => ({ ...prev, [eventId]: data.streamUrl! }));
      }
    } catch {
      // stream unavailable
    }
  }

  async function handleRowClick(eventId: number, leagueId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) { next.delete(eventId); return next; }
      next.add(eventId);
      return next;
    });
    fetchStream(eventId, leagueId);
  }

  function handleExpandAll(allIds: { eventId: number; leagueId: number }[]) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const { eventId } of allIds) next.add(eventId);
      return next;
    });
    for (const { eventId, leagueId } of allIds) fetchStream(eventId, leagueId);
  }

  function handleCollapseAll(allIds: number[]) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const id of allIds) next.delete(id);
      return next;
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🔴 GS Live — Odds Tracker</h1>
        <span className="text-[13px] text-[#666]">{matches.length} trận live</span>
        {loading && <span className="text-[12px] text-[#fbbf24]">Đang cập nhật…</span>}
        {updatedAt && (
          <span className="ml-auto text-[12px] text-[#4ade80]/70">
            ⟳ 5s · {updatedAt}
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
        <>
          <LeagueSection
            title="Giao Hữu Châu Á GS (Ảo) 16 Phút"
            matches={matches.filter((m) => m.leagueId === 2140)}
            prevMap={prevMap}
            expandedIds={expandedIds}
            onRowClick={(id) => handleRowClick(id, 2140)}
            onExpandAll={(ids) => handleExpandAll(ids.map((id) => ({ eventId: id, leagueId: 2140 })))}
            onCollapseAll={handleCollapseAll}
            streamUrls={streamUrls}
            scoredIds={scoredIds}
          />
          <LeagueSection
            title="Giao Hữu Châu Á GS (Ảo) 20 Phút"
            matches={matches.filter((m) => m.leagueId === 2125)}
            prevMap={prevMap}
            expandedIds={expandedIds}
            onRowClick={(id) => handleRowClick(id, 2125)}
            onExpandAll={(ids) => handleExpandAll(ids.map((id) => ({ eventId: id, leagueId: 2125 })))}
            onCollapseAll={handleCollapseAll}
            streamUrls={streamUrls}
            scoredIds={scoredIds}
          />
        </>
      )}
    </>
  );
}

const TABLE_HEADERS = ['#', 'Trận đấu', 'Tỉ số', 'Phase', 'Kèo Chấp H2', 'Tài Xỉu H2', 'Kèo Chấp H1', 'Tài Xỉu H1', 'Tín hiệu'];

function parseMalay(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function Tri({ cur, prev }: { cur: string | null; prev?: string | null | undefined }) {
  const cn = parseMalay(cur), pn = parseMalay(prev);
  const hasChange = cn != null && pn != null && Math.abs(cn - pn) >= 0.005;
  return (
    <span className={`inline-block w-[10px] shrink-0 text-[9px] font-bold leading-none text-center${
      hasChange ? (cn! > pn! ? ' text-[#16a34a]' : ' text-[#dc2626]') : ''
    }`}>
      {hasChange ? (cn! > pn! ? '▲' : '▼') : ''}
    </span>
  );
}

function HomeBox({ children }: { children: React.ReactNode }) {
  return (
    <span className="odds-home-box inline-flex items-center justify-between gap-1 rounded px-2 py-[3px] min-w-[70px] bg-emerald-900/30 border border-emerald-500/20">
      {children}
    </span>
  );
}

function AwayBox({ children }: { children: React.ReactNode }) {
  return (
    <span className="odds-away-box inline-flex items-center justify-between gap-1 rounded px-2 py-[3px] min-w-[70px] bg-rose-900/30 border border-rose-500/20">
      {children}
    </span>
  );
}

const SUSPENDED_CELL = <span className="font-semibold text-[10px] text-[#555]">— — —</span>;

function HcCell({
  lines, prevLines, suspended,
}: {
  lines: { line: string | null; home: string | null; away: string | null }[];
  prevLines?: { line: string | null; home: string | null; away: string | null }[];
  suspended?: boolean;
}) {
  if (lines.length === 0) return <span className="text-[#555]">—</span>;
  if (suspended) return SUSPENDED_CELL;
  return (
    <div className="flex flex-col gap-1">
      {lines.map((row, idx) => {
        const p = prevLines?.[idx];
        const lineNum = row.line != null ? parseFloat(row.line) : NaN;
        // positive (or 0) → Home gives handicap; negative → Away gives handicap
        const homeGives = isNaN(lineNum) || lineNum >= 0;
        const absLineStr = !isNaN(lineNum) ? String(Math.abs(lineNum)) : (row.line ?? '');
        return (
          <div key={idx} className={`flex flex-col gap-[3px]${idx > 0 ? ' mt-1.5 pt-1.5 border-t border-[#2a2a2a]' : ''}`}>
            <div className="flex items-center gap-1.5">
              <HomeBox>
                <span className="inline-block shrink-0 w-[28px] text-right text-[9px] text-[#888] pr-0.5">
                  {homeGives ? (row.line ?? '') : ''}
                </span>
                <RawVal val={row.home} /><Tri cur={row.home} prev={p?.home ?? null} />
              </HomeBox>
            </div>
            <div className="flex items-center gap-1.5">
              <AwayBox>
                <span className="inline-block shrink-0 w-[28px] text-right text-[9px] text-[#888] pr-0.5">
                  {!homeGives ? absLineStr : ''}
                </span>
                <RawVal val={row.away} /><Tri cur={row.away} prev={p?.away ?? null} />
              </AwayBox>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OuCell({
  lines, prevLines, suspended,
}: {
  lines: { line: string | null; over: string | null; under: string | null }[];
  prevLines?: { line: string | null; over: string | null; under: string | null }[];
  suspended?: boolean;
}) {
  if (lines.length === 0) return <span className="text-[#555]">—</span>;
  if (suspended) return SUSPENDED_CELL;
  return (
    <div className="flex flex-col gap-1">
      {lines.map((row, idx) => {
        const p = prevLines?.[idx];
        return (
          <div key={idx} className={`flex flex-col gap-[3px]${idx > 0 ? ' mt-1.5 pt-1.5 border-t border-[#2a2a2a]' : ''}`}>
            <div className="flex items-center gap-1.5">
              <HomeBox>
                <span className="inline-block shrink-0 w-[28px] text-right text-[9px] text-[#888] pr-0.5">{row.line ?? ''}</span>
                <RawVal val={row.over} /><Tri cur={row.over} prev={p?.over ?? null} />
              </HomeBox>
            </div>
            <div className="flex items-center gap-1.5">
              <AwayBox>
                <span className="inline-block shrink-0 w-[28px] text-right text-[9px] text-[#888] pr-0.5">u</span>
                <RawVal val={row.under} /><Tri cur={row.under} prev={p?.under ?? null} />
              </AwayBox>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const GS_STREAM_TOKEN = '69-6aed7dc417eb4882d88c6899ae3c0ae1';

function LeagueSection({
  title,
  matches,
  prevMap,
  expandedIds,
  onRowClick,
  onExpandAll,
  onCollapseAll,
  streamUrls,
  scoredIds,
}: {
  title: string;
  matches: GsLiveMatch[];
  prevMap: Map<number, GsLiveMatch>;
  expandedIds: Set<number>;
  onRowClick: (id: number) => void;
  onExpandAll: (ids: number[]) => void;
  onCollapseAll: (ids: number[]) => void;
  streamUrls: Record<number, string>;
  scoredIds: Set<number>;
}) {
  if (matches.length === 0) return null;
  const COL_COUNT = TABLE_HEADERS.length;
  const allIds = matches.map((m) => m.eventId);
  const allOpen = allIds.every((id) => expandedIds.has(id));
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-[#fbbf24]">{title}</span>
        <span className="text-[11px] text-[#555]">{matches.length} trận · click dòng để xem/ẩn stream</span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => allOpen ? onCollapseAll(allIds) : onExpandAll(allIds)}
            className="rounded px-2 py-0.5 text-[11px] font-semibold border transition-colors"
            style={allOpen
              ? { borderColor: '#f87171', color: '#f87171', background: '#f8717120' }
              : { borderColor: '#4ade80', color: '#4ade80', background: '#4ade8020' }
            }
          >
            {allOpen ? '▲ Tắt tất cả' : '▼ Mở tất cả'}
          </button>
        </div>
      </div>
      <div className="gs-league-table overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <table className="w-full min-w-[1200px] border-collapse bg-[#141414] text-sm">
          <thead>
            <tr>
              {TABLE_HEADERS.map((h, i) => (
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
              const signal = m.suspended ? null : classifySignals(m, prev);
              const isExpanded = expandedIds.has(m.eventId);
              const scored = scoredIds.has(m.eventId);
              const streamUrl = streamUrls[m.eventId];
              return (
                <>
                  <tr
                    key={m.eventId}
                    onClick={() => onRowClick(m.eventId)}
                    className={`cursor-pointer odd:bg-[#141414] even:bg-[#181818] hover:bg-[#222] transition-colors ${
                      scored ? '!bg-[#16a34a]/10' : ''
                    } ${isExpanded ? '!bg-[#1e2a1e] border-l-2 border-[#4ade80]' : ''}`}
                  >
                    <td className="border-b border-[#222] px-2.5 py-2 text-center text-[11px] text-[#555]">
                      {i + 1}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2">
                      <span className="text-white">{m.homeTeam}</span>
                      <span className="mx-1.5 text-[#555]">vs</span>
                      <span className="text-white">{m.awayTeam}</span>
                      {isExpanded && <span className="ml-2 text-[10px] text-[#4ade80]">▼ live</span>}
                    </td>
                    <td className={`whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center font-bold transition-colors ${scored ? 'text-[#22c55e]' : 'text-[#fbbf24]'}`}>
                      {m.h1Home}-{m.h1Away}
                      {scored && <span className="ml-1 text-[10px] animate-bounce">⚽</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-[#222] px-2.5 py-2 text-center text-xs text-[#888]">
                      {phaseLabel(m)}
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2.5 text-xs align-top">
                      <HcCell lines={m.hcLines} prevLines={prev?.hcLines} suspended={m.suspended} />
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2.5 text-xs align-top">
                      <OuCell lines={m.ouLines} prevLines={prev?.ouLines} suspended={m.suspended} />
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2.5 text-xs align-top">
                      <HcCell lines={m.hcH1Lines} prevLines={prev?.hcH1Lines} suspended={m.suspended} />
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2.5 text-xs align-top">
                      <OuCell lines={m.ouH1Lines} prevLines={prev?.ouH1Lines} suspended={m.suspended} />
                    </td>
                    <td className="border-b border-[#222] px-2.5 py-2 align-top">
                      {signal && (
                        <span
                          className="block rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{ color: signal.color, backgroundColor: `${signal.color}22` }}
                        >
                          {signal.label}
                        </span>
                      )}
                      {scored && (
                        <span className="mt-1 block text-[10px] font-bold text-[#22c55e] animate-pulse">
                          ⚽ GÀN!
                        </span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`stream-${m.eventId}`}>
                      <td colSpan={COL_COUNT} className="border-b border-[#333] bg-[#0a0a0a] p-0">
                        {streamUrl ? (
                          <div className="relative">
                            <div className="absolute top-2 right-2 z-10 flex gap-1">
                              <a
                                href={streamUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded px-2 py-1 text-[11px] font-semibold bg-[#1a1a1a]/90 border border-[#444] text-[#aaa] hover:text-white hover:border-[#666]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                ↗ Mở tab mới
                              </a>
                            </div>
                            <iframe
                              src={streamUrl}
                              className="w-full"
                              style={{ height: 520, border: 'none', display: 'block' }}
                              title={`${m.homeTeam} vs ${m.awayTeam}`}
                              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                            />
                          </div>
                        ) : (
                          <div className="flex h-16 items-center justify-center text-[12px] text-[#555]">
                            Đang tải stream…
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
