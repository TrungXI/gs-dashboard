'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  period: number;
  isH2: boolean;
  isLive: boolean;
  oddsHome: number | null;
  oddsAway: number | null;
  oddsDraw: number | null;
  malayHome: string | null;
  malayAway: string | null;
  malayDraw: string | null;
  suspended: boolean;
  hcLines: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  hcH1Lines: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  ouLines: { line: string | null; over: string | null; under: string | null }[];
  ouH1Lines: { line: string | null; over: string | null; under: string | null }[];
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  cornersHome: number;
  cornersAway: number;
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

function phaseLabel(m: GsLiveMatch, nowMs: number): string {
  if (!m.isLive) {
    return nowMs < new Date(m.startTime).getTime() ? 'Chờ' : 'KT';
  }
  // period: 2=H1 live, 4=Halftime, 8=H2 live (ev['10'])
  if (m.period === 4) return 'Nghỉ HT';
  const min = m.minuteElapsed ?? 0;
  if (m.isH2) return `2H ${min}'`;
  return `1H ${min}'`;
}

export default function GSLive() {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prevRef = useRef<Map<number, GsLiveMatch>>(new Map());
  const [prevMap, setPrevMap] = useState<Map<number, GsLiveMatch>>(new Map());
  const [scoredIds, setScoredIds] = useState<Set<number>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loadTs] = useState(() => Date.now());
  // '' = use default; any other string = custom token saved in localStorage
  const [tokenVal, setTokenVal] = useState('');
  const [globalReloadKey, setGlobalReloadKey] = useState(0);

  // Disable page scroll while GS Live is mounted (videos take full row height)
  // — but only on desktop; mobile card list must scroll vertically.
  useEffect(() => {
    const lock = () => {
      document.body.style.overflow = window.innerWidth >= 768 ? 'hidden' : '';
    };
    lock();
    window.addEventListener('resize', lock);
    return () => {
      window.removeEventListener('resize', lock);
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('gs_token');
    if (saved) setTokenVal(saved);
  }, []);

  function applyToken(raw: string) {
    if (!raw.trim()) {
      localStorage.removeItem('gs_token');
      setTokenVal('');
    } else {
      const tok = extractToken(raw);
      localStorage.setItem('gs_token', tok);
      setTokenVal(tok);
    }
  }

  // Tick every 30s so phaseLabel stays current without server round-trip
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;

    async function poll() {
      setLoading(true);
      try {
        const t = localStorage.getItem('gs_token') ?? GS_STREAM_TOKEN;
        const res = await fetch(`/api/gs-live?token=${encodeURIComponent(t)}`, {
          cache: 'no-store',
        });
        const json = (await res.json()) as { ok: boolean; matches?: GsLiveMatch[]; error?: string };
        if (!alive) return;
        if (!json.ok) {
          setError(json.error ?? 'Lỗi tải dữ liệu');
        } else {
          setError(null);
          setPrevMap(new Map(prevRef.current));
          const next = json.matches ?? [];
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
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const activeToken = tokenVal || GS_STREAM_TOKEN;

  return (
    <>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🔴 GS Live — Odds Tracker</h1>
        <span className="text-[13px] text-[#666]">{matches.length} trận live</span>
        {loading && <span className="text-[12px] text-[#fbbf24]">Đang cập nhật…</span>}
        {updatedAt && (
          <span className="ml-auto text-[12px] text-[#4ade80]/70">
            ⟳ 2s · {updatedAt}
          </span>
        )}
      </div>

      {/* Token input — paste raw token or full link */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={tokenVal}
          onChange={(e) => applyToken(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            applyToken(e.clipboardData.getData('text'));
          }}
          placeholder="Dán token hoặc link (để xem video live)…"
          className="w-full md:flex-1 md:max-w-[480px] rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-1.5 text-[12px] text-white placeholder:text-[#444] outline-none focus:border-[#17a2b8] transition-colors"
        />
        {tokenVal && tokenVal !== GS_STREAM_TOKEN ? (
          <span className="text-[11px] text-[#4ade80]">✓ Token tùy chỉnh</span>
        ) : (
          <span className="text-[11px] text-[#555]">Token mặc định</span>
        )}
        <button
          type="button"
          onClick={() => setGlobalReloadKey(k => k + 1)}
          className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-[12px] text-[#aaa] hover:text-white hover:border-[#444] transition-colors"
          title="Reload tất cả video"
        >
          ↺ Reload All
        </button>
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
            scoredIds={scoredIds}
            nowMs={nowMs}
            loadTs={loadTs}
            activeToken={activeToken}
            globalReloadKey={globalReloadKey}
          />
          <LeagueSection
            title="Giao Hữu Châu Á GS (Ảo) 20 Phút"
            matches={matches.filter((m) => m.leagueId === 2125)}
            prevMap={prevMap}
            scoredIds={scoredIds}
            nowMs={nowMs}
            loadTs={loadTs}
            activeToken={activeToken}
            globalReloadKey={globalReloadKey}
          />
        </>
      )}
    </>
  );
}

const TABLE_HEADERS = ['#', 'Trận đấu', 'Tỉ số / Phase', 'Kèo Chấp TT', 'Tài Xỉu TT', 'Kèo Chấp H1', 'Tài Xỉu H1', 'Video'];

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
  lines: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  prevLines?: { line: string | null; home: string | null; away: string | null; homeGives: boolean }[];
  suspended?: boolean;
}) {
  if (lines.length === 0) return <span className="text-[#555]">—</span>;
  if (suspended) return SUSPENDED_CELL;
  return (
    <div className="flex flex-col gap-1">
      {lines.map((row, idx) => {
        const p = prevLines?.[idx];
        const { homeGives } = row;
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
                  {!homeGives ? (row.line ?? '') : ''}
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

const GS_STREAM_TOKEN = '69-940214f0e803120fcfc9183ee4df89d5';

/** Extract token from a raw token string or a full URL (reads ?token= param). */
function extractToken(input: string): string {
  const s = input.trim();
  if (!s) return GS_STREAM_TOKEN;
  try {
    const url = new URL(s);
    const t = url.searchParams.get('token');
    if (t) return t;
  } catch { /* not a URL */ }
  return s;
}

function CardBadges({ yellow, red }: { yellow: number; red: number }) {
  if (!yellow && !red) return null;
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {yellow > 0 && (
        <span className="inline-flex items-center gap-[2px] rounded px-[3px] py-[1px] bg-yellow-500/20 border border-yellow-500/40">
          <span className="text-[9px] text-yellow-400 leading-none">🟨</span>
          <span className="text-[9px] font-bold text-yellow-400 leading-none">{yellow}</span>
        </span>
      )}
      {red > 0 && (
        <span className="inline-flex items-center gap-[2px] rounded px-[3px] py-[1px] bg-red-500/20 border border-red-500/40">
          <span className="text-[9px] text-red-400 leading-none">🟥</span>
          <span className="text-[9px] font-bold text-red-400 leading-none">{red}</span>
        </span>
      )}
    </span>
  );
}

function LeagueSection({
  title,
  matches,
  prevMap,
  scoredIds,
  nowMs,
  loadTs,
  activeToken,
  globalReloadKey,
}: {
  title: string;
  matches: GsLiveMatch[];
  prevMap: Map<number, GsLiveMatch>;
  scoredIds: Set<number>;
  nowMs: number;
  loadTs: number;
  activeToken: string;
  globalReloadKey: number;
}) {
  const [refreshKeys, setRefreshKeys] = useState<Map<number, number>>(new Map());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const cropIframeRef = useRef<HTMLIFrameElement>(null);

  // Mobile video scale: content inside det.zenandfe.com has a fixed internal width.
  // We render the iframe at MOBILE_CONTENT_W then CSS-scale it down to fit the card.
  const MOBILE_CONTENT_W = 320; // zoom out 50% vs 160: scale = containerW/320 ≈ 1.15x
  const MOBILE_DISPLAY_H = 220;
  const [mobileContainerW, setMobileContainerW] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
      ? Math.max(1, window.innerWidth - 24)
      : MOBILE_CONTENT_W
  );
  useEffect(() => {
    function update() {
      if (window.innerWidth < 768) setMobileContainerW(Math.max(1, window.innerWidth - 24));
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const mobileVideoScale = mobileContainerW / MOBILE_CONTENT_W;
  const mobileIframeH = Math.round(MOBILE_DISPLAY_H / mobileVideoScale);

  function bump(eventId: number) {
    setRefreshKeys(prev => {
      const next = new Map(prev);
      next.set(eventId, (prev.get(eventId) ?? 0) + 1);
      return next;
    });
  }

  // CSS transform crop: renders zenandfe.com at 1440px then clips to the .visibility section.
  // IFRAME_W=1440, CROP_LEFT=210 (sidebar), CROP_TOP=320 (header+odds+match-header).
  // scale = containerW / (IFRAME_W - CROP_LEFT) so the video content fills the overlay width.
  // Left/top offsets shift the iframe so x=CROP_LEFT,y=CROP_TOP aligns to (0,0) in container.
  useLayoutEffect(() => {
    if (!expandedId || !cropContainerRef.current || !cropIframeRef.current) return;
    const W = cropContainerRef.current.offsetWidth;
    const H = cropContainerRef.current.offsetHeight;
    const IFRAME_W = 1440;
    const CROP_LEFT = 210;
    const CROP_TOP = 320;
    const scale = W / (IFRAME_W - CROP_LEFT);
    const f = cropIframeRef.current;
    f.style.width = `${IFRAME_W}px`;
    f.style.height = `${Math.ceil(H / scale + CROP_TOP)}px`;
    f.style.position = 'absolute';
    f.style.left = `${Math.round(-CROP_LEFT * scale)}px`;
    f.style.top = `${Math.round(-CROP_TOP * scale)}px`;
    f.style.transform = `scale(${scale})`;
    f.style.transformOrigin = 'top left';
    f.style.border = 'none';
  }, [expandedId]);

  const expandedMatch = expandedId != null ? (matches.find(m => m.eventId === expandedId) ?? null) : null;

  if (matches.length === 0) return null;

  const overlayBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid #444', color: '#aaa',
    borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer',
  };

  return (
    <>
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">{title}</span>
          <span className="text-[11px] text-[#555]">{matches.length} trận</span>
        </div>
        {/* Mobile card list */}
        <div className="flex flex-col gap-3 md:hidden">
          {matches.map((m, i) => {
            const prev = prevMap.get(m.eventId);
            const scored = scoredIds.has(m.eventId);
            const agentId = activeToken.split('-')[0] || '69';
            const refreshKey = refreshKeys.get(m.eventId) ?? 0;
            const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=`;
            return (
              <div
                key={m.eventId}
                className={`rounded-lg border border-[#2a2a2a] bg-[#141414] overflow-hidden ${scored ? '!bg-[#16a34a]/10' : ''}`}
              >
                {/* Header: teams + score + phase */}
                <div className="flex items-start gap-2 px-3 py-2 border-b border-[#222]">
                  <span className="text-[11px] text-[#555] mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[13px] font-semibold text-white truncate">{m.homeTeam}</span>
                      <CardBadges yellow={m.yellowHome} red={m.redHome} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="text-[12px] text-[#888] truncate">{m.awayTeam}</span>
                      <CardBadges yellow={m.yellowAway} red={m.redAway} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`font-bold text-[15px] ${scored ? 'text-[#22c55e]' : 'text-[#fbbf24]'}`}>
                      {m.h1Home} - {m.h1Away}
                    </div>
                    <div className="text-[10px] text-[#888]">{phaseLabel(m, nowMs)}</div>
                  </div>
                </div>

                {/* Odds: 2 segments (TT / H1), mỗi segment 2 kèo */}
                <div className="flex flex-col px-3 py-2 border-b border-[#222] gap-2">
                  {/* TT segment */}
                  <div>
                    <div className="text-[9px] font-bold text-[#4ade80] mb-1 uppercase tracking-wide">TT</div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start gap-3">
                        <div className="text-xs"><HcCell lines={m.hcLines.slice(0,1)} prevLines={prev?.hcLines?.slice(0,1)} suspended={m.suspended} /></div>
                        <div className="text-xs"><OuCell lines={m.ouLines.slice(0,1)} prevLines={prev?.ouLines?.slice(0,1)} suspended={m.suspended} /></div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-xs"><HcCell lines={m.hcLines.slice(1,2)} prevLines={prev?.hcLines?.slice(1,2)} suspended={m.suspended} /></div>
                        <div className="text-xs"><OuCell lines={m.ouLines.slice(1,2)} prevLines={prev?.ouLines?.slice(1,2)} suspended={m.suspended} /></div>
                      </div>
                    </div>
                  </div>
                  {/* H1 segment */}
                  <div className="border-t border-[#2a2a2a] pt-2">
                    <div className="text-[9px] font-bold text-[#60a5fa] mb-1 uppercase tracking-wide">H1</div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-start gap-3">
                        <div className="text-xs"><HcCell lines={m.hcH1Lines.slice(0,1)} prevLines={prev?.hcH1Lines?.slice(0,1)} suspended={m.suspended} /></div>
                        <div className="text-xs"><OuCell lines={m.ouH1Lines.slice(0,1)} prevLines={prev?.ouH1Lines?.slice(0,1)} suspended={m.suspended} /></div>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="text-xs"><HcCell lines={m.hcH1Lines.slice(1,2)} prevLines={prev?.hcH1Lines?.slice(1,2)} suspended={m.suspended} /></div>
                        <div className="text-xs"><OuCell lines={m.ouH1Lines.slice(1,2)} prevLines={prev?.ouH1Lines?.slice(1,2)} suspended={m.suspended} /></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Video — scaled to fit mobile container */}
                <div className="relative bg-black overflow-hidden" style={{ height: MOBILE_DISPLAY_H }}>
                  <iframe
                    key={`m-${m.eventId}-${refreshKey}-${globalReloadKey}`}
                    src={videoUrl}
                    style={{
                      position: 'absolute', top: 0, left: 0,
                      width: MOBILE_CONTENT_W, height: mobileIframeH,
                      border: 'none', display: 'block',
                      transform: `scale(${mobileVideoScale})`,
                      transformOrigin: 'top left',
                    }}
                    title={`${m.homeTeam} vs ${m.awayTeam}`}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                  />
                  <button type="button" onClick={() => setExpandedId(m.eventId)}
                    className="absolute top-1 right-[54px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                    title="Xem fullscreen">⛶</button>
                  <button type="button" onClick={() => bump(m.eventId)}
                    className="absolute top-1 right-[28px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                    title="Reload video">↺</button>
                  <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                    className="absolute top-1 right-1 rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                    onClick={(e) => e.stopPropagation()}>↗</a>
                </div>
              </div>
            );
          })}
        </div>

        <div className="gs-league-table hidden md:block overflow-x-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full min-w-[1200px] border-collapse bg-[#141414] text-sm">
            <thead>
              {/* Group row */}
              <tr>
                <th colSpan={3} className="bg-[#1a1a1a] border-b border-[#2a2a2a]" />
                <th colSpan={2} className="bg-[#1e3a2f] border-b border-[#2a2a2a] px-2 py-1 text-[11px] font-bold text-[#4ade80] text-center border-l border-r border-[#2a2a2a]">
                  Toàn Trận
                </th>
                <th colSpan={2} className="bg-[#1e2d3a] border-b border-[#2a2a2a] px-2 py-1 text-[11px] font-bold text-[#60a5fa] text-center border-l border-r border-[#2a2a2a]">
                  Hiệp 1
                </th>
                <th className="bg-[#1a1a1a] border-b border-[#2a2a2a]" />
              </tr>
              {/* Column row */}
              <tr>
                {TABLE_HEADERS.map((h, i) => (
                  <th
                    key={h}
                    className={`bg-[#1a1a1a] px-2.5 py-2 text-xs font-semibold text-[#aaa] ${
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
                const scored = scoredIds.has(m.eventId);
                const agentId = activeToken.split('-')[0] || '69';
                const refreshKey = refreshKeys.get(m.eventId) ?? 0;
                const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=`;
                return (
                  <tr
                    key={m.eventId}
                    className={`odd:bg-[#141414] even:bg-[#181818] transition-colors ${
                      scored ? '!bg-[#16a34a]/10' : ''
                    }`}
                    style={{ height: 500 }}
                  >
                    {/* # */}
                    <td className="border-b border-[#222] px-2 py-2 text-center text-[11px] text-[#555] align-top w-8">
                      {i + 1}
                    </td>
                    {/* Trận đấu — 2 dòng, compact */}
                    <td className="border-b border-[#222] px-2 py-2 align-top w-[160px] max-w-[160px]">
                      <div className="flex items-center gap-1">
                        <span className="text-[12px] font-semibold text-white leading-tight truncate">{m.homeTeam}</span>
                        <CardBadges yellow={m.yellowHome} red={m.redHome} />
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-[11px] text-[#888] leading-tight truncate">{m.awayTeam}</span>
                        <CardBadges yellow={m.yellowAway} red={m.redAway} />
                      </div>
                      {scored && <div className="mt-1 text-[10px] font-bold text-[#22c55e] animate-pulse">⚽ GÀN!</div>}
                    </td>
                    {/* Tỉ số / Phase */}
                    <td className="border-b border-[#222] px-2 py-2 text-center align-top w-16 whitespace-nowrap">
                      <div className={`font-bold text-sm transition-colors ${scored ? 'text-[#22c55e]' : 'text-[#fbbf24]'}`}>
                        {m.h1Home} - {m.h1Away}
                        {scored && <span className="ml-1 text-[10px] animate-bounce">⚽</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#888]">{phaseLabel(m, nowMs)}</div>
                    </td>
                    {/* Kèo Chấp TT */}
                    <td className="border-b border-[#222] px-2 py-2 text-xs align-top">
                      <HcCell lines={m.hcLines} prevLines={prev?.hcLines} suspended={m.suspended} />
                    </td>
                    {/* Tài Xỉu TT */}
                    <td className="border-b border-[#222] px-2 py-2 text-xs align-top">
                      <OuCell lines={m.ouLines} prevLines={prev?.ouLines} suspended={m.suspended} />
                    </td>
                    {/* Kèo Chấp H1 */}
                    <td className="border-b border-[#222] px-2 py-2 text-xs align-top">
                      <HcCell lines={m.hcH1Lines} prevLines={prev?.hcH1Lines} suspended={m.suspended} />
                    </td>
                    {/* Tài Xỉu H1 */}
                    <td className="border-b border-[#222] px-2 py-2 text-xs align-top">
                      <OuCell lines={m.ouH1Lines} prevLines={prev?.ouH1Lines} suspended={m.suspended} />
                    </td>
                    {/* Video — det.zenandfe.com route=3 */}
                    <td className="border-b border-[#222] p-0 align-middle" style={{ width: '100%', minWidth: 540 }}>
                      <div className="relative bg-black" style={{ height: 500 }}>
                        <iframe
                          key={`${m.eventId}-${refreshKey}-${globalReloadKey}`}
                          src={videoUrl}
                          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                          title={`${m.homeTeam} vs ${m.awayTeam}`}
                          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                          allowFullScreen
                        />
                        {/* Expand to fullscreen (crops to .visibility section) */}
                        <button type="button" onClick={() => setExpandedId(m.eventId)}
                          className="absolute top-1 right-[54px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                          title="Xem fullscreen">⛶</button>
                        {/* Reload iframe when video goes black */}
                        <button type="button" onClick={() => bump(m.eventId)}
                          className="absolute top-1 right-[28px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                          title="Reload video">↺</button>
                        <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                          className="absolute top-1 right-1 rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
                          onClick={(e) => e.stopPropagation()}>↗</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fullscreen overlay — CSS-crops iframe to approximately .visibility section */}
      {expandedMatch != null && (() => {
        const m = expandedMatch;
        const agentId = activeToken.split('-')[0] || '69';
        const refreshKey = refreshKeys.get(m.eventId) ?? 0;
        const eUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=`;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#111', borderBottom: '1px solid #222', flexShrink: 0, height: 32 }}>
              <span style={{ color: '#aaa', fontSize: 11, fontWeight: 600 }}>{m.homeTeam} vs {m.awayTeam}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => bump(m.eventId)} style={overlayBtn} title="Reload video">↺</button>
                <a href={eUrl} target="_blank" rel="noopener noreferrer" style={{ ...overlayBtn, textDecoration: 'none' }}>↗</a>
                <button type="button" onClick={() => setExpandedId(null)} style={{ ...overlayBtn, color: '#f87171' }}>✕</button>
              </div>
            </div>
            <div ref={cropContainerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <iframe
                ref={cropIframeRef}
                key={`expanded-${m.eventId}-${refreshKey}`}
                src={eUrl}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                title={`${m.homeTeam} vs ${m.awayTeam}`}
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
              />
            </div>
          </div>
        );
      })()}
    </>
  );
}
