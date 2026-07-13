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

interface Toast {
  id: number;
  kind: 'goal' | 'halftime';
  message: string;
}

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
  // H1 final scores remembered at the H1→H2 transition (API has no dedicated H1-final field)
  const h1FinalRef = useRef<Map<number, { home: number; away: number }>>(new Map());
  const [h1Finals, setH1Finals] = useState<Map<number, { home: number; away: number }>>(new Map());
  const [scoredIds, setScoredIds] = useState<Set<number>>(new Set());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const osNotiRef = useRef(false);
  const [loadTs] = useState(() => Date.now());
  // '' = use default; any other string = custom token saved in localStorage
  const [tokenVal, setTokenVal] = useState('');
  const [globalReloadKey, setGlobalReloadKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoStream, setAutoStream] = useState(false);
  const [osNoti, setOsNoti] = useState(false);

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

  useEffect(() => {
    setAutoStream(localStorage.getItem('gs_auto_stream') === '1');
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('gs_os_noti') === '1';
    setOsNoti(saved);
    osNotiRef.current = saved;
  }, []);

  useEffect(() => { osNotiRef.current = osNoti; }, [osNoti]);

  function notifyOS(title: string, body: string) {
    if (!osNotiRef.current) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body, silent: false });
  }

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

  function pushToast(kind: Toast['kind'], message: string) {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, kind === 'goal' ? 4000 : 6000);
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
            if (!pm) continue;
            if (nm.h1Home > pm.h1Home) {
              newScored.add(nm.eventId);
              pushToast('goal', `⚽ ${nm.homeTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away}`);
              notifyOS('⚽ Ghi bàn!', `${nm.homeTeam} ghi bàn — ${nm.h1Home}–${nm.h1Away} ${nm.awayTeam}`);
            }
            if (nm.h1Away > pm.h1Away) {
              newScored.add(nm.eventId);
              pushToast('goal', `⚽ ${nm.awayTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away}`);
              notifyOS('⚽ Ghi bàn!', `${nm.awayTeam} ghi bàn — ${nm.homeTeam} ${nm.h1Home}–${nm.h1Away}`);
            }
          }
          if (newScored.size > 0) {
            setScoredIds(newScored);
            setTimeout(() => setScoredIds(new Set()), 3000);
          }
          // Detect H1→H2 transition: remember score just before H2 starts as H1 final
          let h1Changed = false;
          for (const nm of next) {
            if (nm.isH2 && !h1FinalRef.current.has(nm.eventId)) {
              const pm = prevRef.current.get(nm.eventId);
              if (pm && !pm.isH2) {
                h1FinalRef.current.set(nm.eventId, { home: pm.h1Home, away: pm.h1Away });
                h1Changed = true;
                pushToast('halftime', `🔔 Hết Hiệp 1 — ${nm.homeTeam} ${pm.h1Home}–${pm.h1Away} ${nm.awayTeam}`);
                notifyOS('🔔 Hết Hiệp 1', `${nm.homeTeam} ${pm.h1Home}–${pm.h1Away} ${nm.awayTeam}`);
              }
            }
          }
          if (h1Changed) setH1Finals(new Map(h1FinalRef.current));
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

    if (!autoRefresh) return () => { alive = false; };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [autoRefresh]);

  const activeToken = tokenVal || GS_STREAM_TOKEN;

  function dismissToast(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🔴 GS Live — Odds Tracker</h1>
        <span className="text-[13px] text-[#666]">{matches.length} trận live</span>
        <button
          type="button"
          onClick={() => setAutoRefresh(r => !r)}
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${autoRefresh ? 'border-[#4ade80]/40 text-[#4ade80] bg-[#4ade80]/10 hover:bg-[#4ade80]/20' : 'border-[#f87171]/40 text-[#f87171] bg-[#f87171]/10 hover:bg-[#f87171]/20'}`}
          title={autoRefresh ? 'Tạm dừng cập nhật tự động' : 'Bật cập nhật tự động'}
        >
          {autoRefresh ? '⏸ Auto' : '▶ Auto'}
        </button>
        <button
          type="button"
          onClick={() => setAutoStream(s => { const next = !s; localStorage.setItem('gs_auto_stream', next ? '1' : '0'); return next; })}
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${autoStream ? 'border-[#a78bfa]/40 text-[#a78bfa] bg-[#a78bfa]/10 hover:bg-[#a78bfa]/20' : 'border-[#555] text-[#777] bg-transparent hover:border-[#a78bfa]/40 hover:text-[#a78bfa]'}`}
          title={autoStream ? 'Tắt stream tự động (cần click ▶ thủ công)' : 'Bật stream tự động (load video ngay khi có trận)'}
        >
          {autoStream ? '📺 Stream tự động' : '📺 Stream thủ công'}
        </button>
        <span className="ml-auto text-[12px]">
          {autoRefresh && loading
            ? <span className="text-[#fbbf24]">⟳ Đang cập nhật…</span>
            : updatedAt
              ? <span className="text-[#4ade80]/70">{autoRefresh ? `⟳ 2s · ${updatedAt}` : `⏸ dừng · ${updatedAt}`}</span>
              : null}
        </span>
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
        <button
          type="button"
          onClick={() => {
            const next = !osNoti;
            if (next && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
              Notification.requestPermission().then(p => {
                if (p === 'granted') { setOsNoti(true); localStorage.setItem('gs_os_noti', '1'); }
              });
            } else {
              setOsNoti(next);
              localStorage.setItem('gs_os_noti', next ? '1' : '0');
            }
          }}
          className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${osNoti ? 'border-[#fb923c]/40 text-[#fb923c] bg-[#fb923c]/10 hover:bg-[#fb923c]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={osNoti ? 'Tắt thông báo Macbook' : 'Bật thông báo Macbook (goal & hết H1)'}
        >
          {osNoti ? '🔔 Noti ON' : '🔕 Noti OFF'}
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
            h1Finals={h1Finals}
            autoStream={autoStream}
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
            h1Finals={h1Finals}
            autoStream={autoStream}
          />
        </>
      )}
    </>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast-item pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-2xl cursor-pointer select-none whitespace-nowrap ${
            t.kind === 'goal'
              ? 'bg-[#14532d]/95 border border-[#22c55e]/50 text-[#bbf7d0]'
              : 'bg-[#78350f]/95 border border-[#fbbf24]/60 text-[#fef3c7]'
          }`}
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
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

// Fix #1: click-to-load — iframe chỉ mount khi user bấm ▶
// Fix #2: mỗi VideoCell quản lý state riêng → mobile & desktop tree không share iframe
// Fix #3: IntersectionObserver — unload iframe khi scroll ra ngoài viewport (rootMargin 300px buffer)
function VideoCell({
  iframeKey, src, title, displayW, displayH, contentW, iframeH, scale, onExpand, onReload, externalUrl, autoStream,
}: {
  iframeKey: string; src: string; title: string;
  displayW: number; displayH: number; contentW: number; iframeH: number; scale: number;
  onExpand: () => void; onReload: () => void; externalUrl: string; autoStream: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoStream) setLoaded(true);
  }, [autoStream]);

  useEffect(() => {
    if (!loaded || autoStream) return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (!entry.isIntersecting) setLoaded(false); },
      { rootMargin: '300px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loaded, autoStream]);

  return (
    <div ref={containerRef} className="relative bg-black overflow-hidden" style={{ width: displayW, height: displayH }}>
      {loaded ? (
        <iframe
          key={iframeKey}
          src={src}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: contentW, height: iframeH,
            border: 'none', display: 'block',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#444] hover:text-[#888] transition-colors"
        >
          <span className="text-3xl">▶</span>
          <span className="text-[11px]">Xem video</span>
        </button>
      )}
      <button type="button" onClick={onExpand}
        className="absolute top-1 right-[54px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
        title="Xem fullscreen">⛶</button>
      <button type="button" onClick={onReload}
        className="absolute top-1 right-[28px] rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
        title="Reload video">↺</button>
      <a href={externalUrl} target="_blank" rel="noopener noreferrer"
        className="absolute top-1 right-1 rounded px-1.5 py-0.5 text-[10px] bg-black/70 text-[#aaa] hover:text-white border border-[#444]/50 z-10"
        onClick={(e) => e.stopPropagation()}>↗</a>
    </div>
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
  h1Finals,
  autoStream,
}: {
  title: string;
  matches: GsLiveMatch[];
  prevMap: Map<number, GsLiveMatch>;
  scoredIds: Set<number>;
  nowMs: number;
  loadTs: number;
  activeToken: string;
  globalReloadKey: number;
  h1Finals: Map<number, { home: number; away: number }>;
  autoStream: boolean;
}) {
  const [refreshKeys, setRefreshKeys] = useState<Map<number, number>>(new Map());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const cropIframeRef = useRef<HTMLIFrameElement>(null);

  // Mobile video: scale so iframe width fits exactly MOBILE_DISPLAY_W.
  const MOBILE_CONTENT_W = 1440;
  const MOBILE_DISPLAY_W = 390;
  const MOBILE_DISPLAY_H = 280;
  const mobileScale = MOBILE_DISPLAY_W / MOBILE_CONTENT_W;
  const mobileIframeH = Math.round(MOBILE_DISPLAY_H / mobileScale);

  // Desktop video: scale so iframe width fits exactly DESKTOP_DISPLAY_W.
  const DESKTOP_CONTENT_W = 1440;
  const DESKTOP_DISPLAY_W = 500;
  const DESKTOP_DISPLAY_H = 320;
  const desktopScale = DESKTOP_DISPLAY_W / DESKTOP_CONTENT_W;
  const desktopIframeH = Math.round(DESKTOP_DISPLAY_H / desktopScale);

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

  // Sort by eventId for stable DOM order across polls — prevents scroll jump when API reorders
  const sorted = [...matches].sort((a, b) => a.eventId - b.eventId);

  if (sorted.length === 0) return null;

  const overlayBtn: React.CSSProperties = {
    background: 'transparent', border: '1px solid #444', color: '#aaa',
    borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer',
  };

  return (
    <>
      <div className="mb-5">
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">{title}</span>
          <span className="text-[11px] text-[#555]">{sorted.length} trận</span>
        </div>
        {/* Mobile card list — overflow-anchor:none prevents browser from auto-adjusting scroll on data update */}
        <div className="flex flex-col gap-3 md:hidden" style={{ overflowAnchor: 'none' }}>
          {sorted.map((m, i) => {
            const prev = prevMap.get(m.eventId);
            const scored = scoredIds.has(m.eventId);
            const agentId = activeToken.split('-')[0] || '69';
            const refreshKey = refreshKeys.get(m.eventId) ?? 0;
            const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=&muted=1`;
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
                    {m.isH2 && h1Finals.has(m.eventId) && (
                      <div className="text-[10px] text-[#aaa]">H1: {h1Finals.get(m.eventId)!.home}-{h1Finals.get(m.eventId)!.away}</div>
                    )}
                    <div className="text-[10px] text-[#888]">{phaseLabel(m, nowMs)}</div>
                  </div>
                </div>

                {/* Odds: 2 segments (TT / H1), mỗi segment 2 kèo */}
                <div className="flex flex-col px-3 py-2 border-b border-[#222] gap-2">
                  {/* TT segment */}
                  <div>
                    <div className="text-[9px] font-bold text-[#4ade80] mb-1 uppercase tracking-wide">TT</div>
                    <div className="flex gap-3">
                      <div className="flex flex-col gap-1 flex-1">
                        <div className="text-xs"><HcCell lines={m.hcLines.slice(0,1)} prevLines={prev?.hcLines?.slice(0,1)} suspended={m.suspended} /></div>
                        <div className="text-xs"><HcCell lines={m.hcLines.slice(1,2)} prevLines={prev?.hcLines?.slice(1,2)} suspended={m.suspended} /></div>
                      </div>
                      <div className="flex flex-col gap-1 flex-1">
                        <div className="text-xs"><OuCell lines={m.ouLines.slice(0,1)} prevLines={prev?.ouLines?.slice(0,1)} suspended={m.suspended} /></div>
                        <div className="text-xs"><OuCell lines={m.ouLines.slice(1,2)} prevLines={prev?.ouLines?.slice(1,2)} suspended={m.suspended} /></div>
                      </div>
                    </div>
                  </div>
                  {/* H1 segment — ẩn khi không có kèo */}
                  {(m.hcH1Lines.length > 0 || m.ouH1Lines.length > 0) && (
                    <div className="border-t border-[#2a2a2a] pt-2">
                      <div className="text-[9px] font-bold text-[#60a5fa] mb-1 uppercase tracking-wide">H1</div>
                      <div className="flex gap-3">
                        <div className="flex flex-col gap-1 flex-1">
                          <div className="text-xs"><HcCell lines={m.hcH1Lines.slice(0,1)} prevLines={prev?.hcH1Lines?.slice(0,1)} suspended={m.suspended} /></div>
                          <div className="text-xs"><HcCell lines={m.hcH1Lines.slice(1,2)} prevLines={prev?.hcH1Lines?.slice(1,2)} suspended={m.suspended} /></div>
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <div className="text-xs"><OuCell lines={m.ouH1Lines.slice(0,1)} prevLines={prev?.ouH1Lines?.slice(0,1)} suspended={m.suspended} /></div>
                          <div className="text-xs"><OuCell lines={m.ouH1Lines.slice(1,2)} prevLines={prev?.ouH1Lines?.slice(1,2)} suspended={m.suspended} /></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <VideoCell
                  iframeKey={`m-${m.eventId}-${refreshKey}-${globalReloadKey}`}
                  src={videoUrl}
                  title={`${m.homeTeam} vs ${m.awayTeam}`}
                  displayW={MOBILE_DISPLAY_W}
                  displayH={MOBILE_DISPLAY_H}
                  contentW={MOBILE_CONTENT_W}
                  iframeH={mobileIframeH}
                  scale={mobileScale}
                  onExpand={() => setExpandedId(m.eventId)}
                  onReload={() => bump(m.eventId)}
                  externalUrl={videoUrl}
                  autoStream={autoStream}
                />
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
            <tbody style={{ overflowAnchor: 'none' }}>
              {sorted.map((m, i) => {
                const prev = prevMap.get(m.eventId);
                const scored = scoredIds.has(m.eventId);
                const agentId = activeToken.split('-')[0] || '69';
                const refreshKey = refreshKeys.get(m.eventId) ?? 0;
                const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=&muted=1`;
                return (
                  <tr
                    key={m.eventId}
                    className={`odd:bg-[#141414] even:bg-[#181818] transition-colors ${
                      scored ? '!bg-[#16a34a]/10' : ''
                    }`}
                    style={{ height: DESKTOP_DISPLAY_H }}
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
                      {m.isH2 && h1Finals.has(m.eventId) && (
                        <div className="mt-0.5 text-[10px] text-[#aaa]">H1: {h1Finals.get(m.eventId)!.home}-{h1Finals.get(m.eventId)!.away}</div>
                      )}
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
                    <td className="border-b border-[#222] p-0 align-middle" style={{ minWidth: DESKTOP_DISPLAY_W, width: DESKTOP_DISPLAY_W }}>
                      <VideoCell
                        iframeKey={`${m.eventId}-${refreshKey}-${globalReloadKey}`}
                        src={videoUrl}
                        title={`${m.homeTeam} vs ${m.awayTeam}`}
                        displayW={DESKTOP_DISPLAY_W}
                        displayH={DESKTOP_DISPLAY_H}
                        contentW={DESKTOP_CONTENT_W}
                        iframeH={desktopIframeH}
                        scale={desktopScale}
                        onExpand={() => setExpandedId(m.eventId)}
                        onReload={() => bump(m.eventId)}
                        externalUrl={videoUrl}
                        autoStream={autoStream}
                      />
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
        const eUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=&muted=1`;
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
