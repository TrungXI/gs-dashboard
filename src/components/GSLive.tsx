'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Match } from '../types/match';
import { resultFor } from '../lib/stats';
import { teamDayStats, todayDayOfWeek, todayStats, bestAndWorstDay, DAY_LABELS_FULL, type DayStats, type DayOfWeek } from '../lib/dayStats';
import { TypeBadge, ResultTag } from './badges';

interface AnalysisSnapshot {
  snapshotType: string;
  scoreHome: number;
  scoreAway: number;
  hcLine: string | null;
  hcHomeOdds: string | null;
  hcAwayOdds: string | null;
  hcH1Line: string | null;
  hcH1HomeOdds: string | null;
  hcH1AwayOdds: string | null;
  ouLine: string | null;
  ouOver: string | null;
  ouUnder: string | null;
  ouH1Line: string | null;
  ouH1Over: string | null;
  ouH1Under: string | null;
  recordedAt: string | null;
}

interface AnalysisMatch {
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  matchDate: string | null;
  matchType: string | null;
  finalScore: { home: number; away: number };
  snapshots: AnalysisSnapshot[];
}

interface SimilarResult {
  group: AnalysisMatch;
  pts: number;
  matchingSnap: AnalysisSnapshot | null;
}

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

function computeSimilarity(live: GsLiveMatch, group: AnalysisMatch): SimilarResult {
  const snap = group.snapshots.find(
    (s) => s.scoreHome === live.h1Home && s.scoreAway === live.h1Away,
  ) ?? null;
  if (!snap) return { group, pts: 0, matchingSnap: null };

  let pts = 3;
  if (live.hcLines[0]?.line && snap.hcLine === live.hcLines[0].line) pts += 2;
  if (live.ouLines[0]?.line && snap.ouLine === live.ouLines[0].line) pts += 2;
  if (live.hcH1Lines[0]?.line && snap.hcH1Line === live.hcH1Lines[0].line) pts += 1;
  if (live.ouH1Lines[0]?.line && snap.ouH1Line === live.ouH1Lines[0].line) pts += 1;
  const lhcH = live.hcLines[0]?.home;
  if (lhcH && snap.hcHomeOdds && Math.abs(parseFloat(lhcH) - parseFloat(snap.hcHomeOdds)) < 0.06) pts += 1;
  const louO = live.ouLines[0]?.over;
  if (louO && snap.ouOver && Math.abs(parseFloat(louO) - parseFloat(snap.ouOver)) < 0.06) pts += 1;

  return { group, pts, matchingSnap: snap };
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
  const osNotiGoalRef = useRef(false);
  const osNotiHTRef = useRef(false);
  const [loadTs] = useState(() => Date.now());
  // '' = use default; any other string = custom token saved in localStorage
  const [tokenVal, setTokenVal] = useState('');
  const [globalReloadKey, setGlobalReloadKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoStream, setAutoStream] = useState(false);
  const [similarMatch, setSimilarMatch] = useState<GsLiveMatch | null>(null);
  const [analysisMatch, setAnalysisMatch] = useState<GsLiveMatch | null>(null);
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);


  useEffect(() => {
    const saved = localStorage.getItem('gs_token');
    if (saved) setTokenVal(saved);
  }, []);

  useEffect(() => {
    setAutoStream(localStorage.getItem('gs_auto_stream') === '1');
  }, []);

  useEffect(() => {
    const g = localStorage.getItem('gs_os_noti_goal') === '1';
    const h = localStorage.getItem('gs_os_noti_ht') === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h);   osNotiHTRef.current = h;
  }, []);

  useEffect(() => { osNotiGoalRef.current = osNotiGoal; }, [osNotiGoal]);
  useEffect(() => { osNotiHTRef.current = osNotiHT; }, [osNotiHT]);

  async function requestAndSet(
    key: string,
    setter: (v: boolean) => void,
    ref: { current: boolean },
  ) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    setter(true); ref.current = true;
    localStorage.setItem(key, '1');
  }

  function notifyOS(kind: 'goal' | 'ht', title: string, body: string, eventId?: number) {
    const allowed = kind === 'goal' ? osNotiGoalRef.current : osNotiHTRef.current;
    if (!allowed) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, silent: false });
    if (eventId != null) {
      n.onclick = () => {
        window.focus();
        document.querySelector(`[data-event-id="${eventId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    }
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
    }, kind === 'goal' ? 10000 : 20000);
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
            const matchTime = `${nm.isH2 ? '2H' : '1H'} ${nm.minuteElapsed ?? 0}'`;
            if (nm.h1Home > pm.h1Home) {
              newScored.add(nm.eventId);
              pushToast('goal', `⚽ ${nm.homeTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away} · ${matchTime}`);
              notifyOS('goal', '⚽ Ghi bàn!', `${nm.homeTeam} ghi bàn — ${nm.h1Home}–${nm.h1Away} ${nm.awayTeam} (${matchTime})`, nm.eventId);
            }
            if (nm.h1Away > pm.h1Away) {
              newScored.add(nm.eventId);
              pushToast('goal', `⚽ ${nm.awayTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away} · ${matchTime}`);
              notifyOS('goal', '⚽ Ghi bàn!', `${nm.awayTeam} ghi bàn — ${nm.homeTeam} ${nm.h1Home}–${nm.h1Away} (${matchTime})`, nm.eventId);
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
                notifyOS('ht', '🔔 Hết Hiệp 1', `${nm.homeTeam} ${pm.h1Home}–${pm.h1Away} ${nm.awayTeam}`, nm.eventId);
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
            if (osNotiGoal) { setOsNotiGoal(false); osNotiGoalRef.current = false; localStorage.setItem('gs_os_noti_goal', '0'); }
            else requestAndSet('gs_os_noti_goal', setOsNotiGoal, osNotiGoalRef);
          }}
          className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${osNotiGoal ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={osNotiGoal ? 'Tắt noti ghi bàn' : 'Bật noti ghi bàn ra Macbook'}
        >
          {osNotiGoal ? '⚽ Ghi bàn ON' : '⚽ Ghi bàn OFF'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (osNotiHT) { setOsNotiHT(false); osNotiHTRef.current = false; localStorage.setItem('gs_os_noti_ht', '0'); }
            else requestAndSet('gs_os_noti_ht', setOsNotiHT, osNotiHTRef);
          }}
          className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${osNotiHT ? 'border-[#fbbf24]/40 text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={osNotiHT ? 'Tắt noti hết H1' : 'Bật noti hết H1 ra Macbook'}
        >
          {osNotiHT ? '🔔 Hết H1 ON' : '🔔 Hết H1 OFF'}
        </button>
      </div>

      {similarMatch && <SimilarMatchesDrawer live={similarMatch} onClose={() => setSimilarMatch(null)} />}
      {analysisMatch && <LiveAnalysisDrawer live={analysisMatch} onClose={() => setAnalysisMatch(null)} />}

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
            onSimilar={setSimilarMatch}
            onAnalysis={setAnalysisMatch}
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
            onSimilar={setSimilarMatch}
            onAnalysis={setAnalysisMatch}
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
  onSimilar,
  onAnalysis,
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
  onSimilar: (m: GsLiveMatch) => void;
  onAnalysis: (m: GsLiveMatch) => void;
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
        <div className="flex flex-col gap-3 md:hidden">
          {sorted.map((m, i) => {
            const prev = prevMap.get(m.eventId);
            const scored = scoredIds.has(m.eventId);
            const agentId = activeToken.split('-')[0] || '69';
            const refreshKey = refreshKeys.get(m.eventId) ?? 0;
            const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=&muted=1`;
            const isHT = m.period === 4;
            return (
              <div
                key={m.eventId}
                data-event-id={m.eventId}
                className={`rounded-lg border overflow-hidden ${scored ? 'border-[#2a2a2a] !bg-[#16a34a]/10' : isHT ? 'border-amber-500/50 bg-amber-900/25' : 'border-[#2a2a2a] bg-[#141414]'}`}
              >
                {/* Header: teams + score + phase */}
                <div className="flex items-start gap-2 px-3 py-2 border-b border-[#222]">
                  <span className="text-[11px] text-[#555] mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className={`text-[13px] font-semibold truncate ${isHT ? 'text-amber-300' : 'text-white'}`}>{m.homeTeam}</span>
                      <CardBadges yellow={m.yellowHome} red={m.redHome} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className={`text-[12px] truncate ${isHT ? 'text-amber-400' : 'text-[#888]'}`}>{m.awayTeam}</span>
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
                  <button
                    type="button"
                    onClick={() => onSimilar(m)}
                    className="flex-shrink-0 rounded px-1.5 py-1 text-[11px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#444] transition-colors"
                    title="Tìm trận tương tự"
                  >
                    🔍
                  </button>
                  <button
                    type="button"
                    onClick={() => onAnalysis(m)}
                    className="flex-shrink-0 rounded px-1.5 py-1 text-[11px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#60a5fa] hover:border-[#444] transition-colors"
                    title="Phân tích 2 đội"
                  >
                    📊
                  </button>
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
            <tbody>
              {sorted.map((m, i) => {
                const prev = prevMap.get(m.eventId);
                const scored = scoredIds.has(m.eventId);
                const agentId = activeToken.split('-')[0] || '69';
                const refreshKey = refreshKeys.get(m.eventId) ?? 0;
                const videoUrl = `https://det.zenandfe.com/?token=${encodeURIComponent(activeToken)}&agentId=${agentId}&lng=vi&sportId=1&route=3&eventId=${m.eventId}&brand=&muted=1`;
                const isHT = m.period === 4;
                return (
                  <tr
                    key={m.eventId}
                    data-event-id={m.eventId}
                    className={`odd:bg-[#141414] even:bg-[#181818] transition-colors ${
                      scored ? '!bg-[#16a34a]/10' : isHT ? '!bg-amber-900/25' : ''
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
                        <span className={`text-[12px] font-semibold leading-tight truncate ${isHT ? 'text-amber-300' : 'text-white'}`}>{m.homeTeam}</span>
                        <CardBadges yellow={m.yellowHome} red={m.redHome} />
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <span className={`text-[11px] leading-tight truncate ${isHT ? 'text-amber-400' : 'text-[#888]'}`}>{m.awayTeam}</span>
                        <CardBadges yellow={m.yellowAway} red={m.redAway} />
                      </div>
                      {scored && <div className="mt-1 text-[10px] font-bold text-[#22c55e] animate-pulse">⚽ GÀN!</div>}
                      <button
                        type="button"
                        onClick={() => onSimilar(m)}
                        className="mt-1.5 rounded px-2 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-white hover:border-[#444] transition-colors"
                        title="Tìm trận tương tự"
                      >
                        🔍 Tương tự
                      </button>
                      <button
                        type="button"
                        onClick={() => onAnalysis(m)}
                        className="mt-1 rounded px-2 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#60a5fa] hover:border-[#444] transition-colors"
                        title="Phân tích 2 đội"
                      >
                        📊 Phân tích
                      </button>
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

function LiveAnalysisDrawer({ live, onClose }: { live: GsLiveMatch; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [activeTab, setActiveTab] = useState<'stats' | 'suggest'>('suggest');
  const [claudePrediction, setClaudePrediction] = useState('');
  const [pythonStats, setPythonStats] = useState('');
  const [predicting, setPredicting] = useState(false);
  const [mlSamples, setMlSamples] = useState<number | null>(null);
  const predAbortRef = useRef<AbortController | null>(null);
  const [goalFlash, setGoalFlash] = useState(false);
  const [activeDot, setActiveDot] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const prevScoreRef = useRef(`${live.h1Home}-${live.h1Away}`);
  const [prevPredCount, setPrevPredCount] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMatches(null);
    const url = `/api/gs-team-analysis?home=${encodeURIComponent(live.homeTeam)}&away=${encodeURIComponent(live.awayTeam)}`;
    fetch(url)
      .then(r => r.json())
      .then((json: { ok: boolean; matches?: Match[] }) => {
        if (!alive) return;
        setMatches(json.matches ?? []);
      })
      .catch(() => { if (alive) setMatches([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [live.homeTeam, live.awayTeam]);

  // Live API may send Vietnamese names ("Nhật Bản") but DB stores English ("Japan")
  const VN_TO_EN: Record<string, string> = {
    'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
    'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Nga': 'Russia',
    'Đức': 'Germany', 'Pháp': 'France', 'Tây Ban Nha': 'Spain',
    'Bồ Đào Nha': 'Portugal', 'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium',
    'Thụy Sĩ': 'Switzerland(CHE)', 'Thụy Điển': 'Sweden', 'Na Uy': 'Norway',
    'Áo': 'Austria', 'Ý': 'Italy', 'Anh': 'England',
    'Maroc': 'Morocco', 'Mỹ': 'USA', 'Ả Rập Xê Út': 'Saudi Arabia',
    'Úc': 'Australia', 'Ấn Độ': 'India', 'Campuchia': 'Cambodia', 'Lào': 'Laos',
  };
  const resolveDbName = (liveName: string): string => {
    if (!matches) return liveName;
    // Exact match first
    for (const m of matches) {
      if (m.homeTeam === liveName) return m.homeTeam;
      if (m.awayTeam === liveName) return m.awayTeam;
    }
    // Translate Vietnamese → English, then match by base + suffix
    const rawBase = liveName.replace(/ \([VS]\)$/, '').trim();
    const enBase = VN_TO_EN[rawBase] ?? rawBase;
    const suffix = liveName.endsWith('(S)') ? '(S)' : liveName.endsWith('(V)') ? '(V)' : null;
    if (suffix) {
      for (const m of matches) {
        if (m.homeTeam.startsWith(enBase) && m.homeTeam.endsWith(suffix)) return m.homeTeam;
        if (m.awayTeam.startsWith(enBase) && m.awayTeam.endsWith(suffix)) return m.awayTeam;
      }
    }
    return liveName;
  };

  const homeDbName = resolveDbName(live.homeTeam);
  const awayDbName = resolveDbName(live.awayTeam);

  // Form: last 100 for each team
  const homeMatches = matches
    ? matches.filter(m => m.homeTeam === homeDbName || m.awayTeam === homeDbName).slice(0, 100)
    : [];
  const awayMatches = matches
    ? matches.filter(m => m.homeTeam === awayDbName || m.awayTeam === awayDbName).slice(0, 100)
    : [];

  // H2H: matches between both teams, last 100
  const h2hMatches = matches
    ? matches.filter(m =>
        (m.homeTeam === homeDbName && m.awayTeam === awayDbName) ||
        (m.homeTeam === awayDbName && m.awayTeam === homeDbName)
      ).slice(0, 100)
    : [];

  // Day stats
  const today = todayDayOfWeek();
  const todayLabel = DAY_LABELS_FULL[today];
  const homeDayStats = matches ? teamDayStats(matches, homeDbName) : [];
  const awayDayStats = matches ? teamDayStats(matches, awayDbName) : [];

  // Prediction stat bars — computed instantly from existing data
  const homeW = homeMatches.filter(m => resultFor(m, homeDbName) === 'W').length;
  const homeD = homeMatches.filter(m => resultFor(m, homeDbName) === 'D').length;
  const homeL = homeMatches.filter(m => resultFor(m, homeDbName) === 'L').length;
  const awayW = awayMatches.filter(m => resultFor(m, awayDbName) === 'W').length;
  const awayD = awayMatches.filter(m => resultFor(m, awayDbName) === 'D').length;
  const awayL = awayMatches.filter(m => resultFor(m, awayDbName) === 'L').length;

  // Goals conceded avg & hold rate (when leading at H1, did they win full time?)
  const homeAvgConceded = homeMatches.length
    ? homeMatches.reduce((s, m) => s + (m.homeTeam === homeDbName ? +m.ttAway : +m.ttHome), 0) / homeMatches.length
    : 0;
  const awayAvgConceded = awayMatches.length
    ? awayMatches.reduce((s, m) => s + (m.homeTeam === awayDbName ? +m.ttAway : +m.ttHome), 0) / awayMatches.length
    : 0;
  const homeHoldW = homeMatches.filter(m => {
    const isHome = m.homeTeam === homeDbName;
    return (isHome ? +m.h1Home > +m.h1Away : +m.h1Away > +m.h1Home) && resultFor(m, homeDbName) === 'W';
  }).length;
  const homeHoldTotal = homeMatches.filter(m => {
    const isHome = m.homeTeam === homeDbName;
    return isHome ? +m.h1Home > +m.h1Away : +m.h1Away > +m.h1Home;
  }).length;
  const awayHoldW = awayMatches.filter(m => {
    const isHome = m.homeTeam === awayDbName;
    return (isHome ? +m.h1Home > +m.h1Away : +m.h1Away > +m.h1Home) && resultFor(m, awayDbName) === 'W';
  }).length;
  const awayHoldTotal = awayMatches.filter(m => {
    const isHome = m.homeTeam === awayDbName;
    return isHome ? +m.h1Home > +m.h1Away : +m.h1Away > +m.h1Home;
  }).length;
  const h2hHomeW = h2hMatches.filter(m => {
    const hs = +m.ttHome; const as = +m.ttAway;
    return m.homeTeam === homeDbName ? hs > as : as > hs;
  }).length;
  const h2hDraws = h2hMatches.filter(m => +m.ttHome === +m.ttAway).length;
  const h2hAwayW = h2hMatches.length - h2hHomeW - h2hDraws;

  // Which team has scoring advantage (null = balanced)
  const favoredTeam = useMemo<string | null>(() => {
    const homeFormPts = homeW * 3 + homeD;
    const awayFormPts = awayW * 3 + awayD;
    const total = homeFormPts + awayFormPts;
    let p = total > 0 ? homeFormPts / total : 0.5;
    if (h2hMatches.length > 0) {
      p = p * 0.7 + ((h2hHomeW + h2hDraws * 0.5) / h2hMatches.length) * 0.3;
    }
    const diff = live.h1Home - live.h1Away;
    if (diff > 0) p -= 0.08;
    if (diff < 0) p += 0.08;
    const hcVal = live.hcLines[0]?.home ? parseFloat(live.hcLines[0].home) : null;
    if (hcVal !== null && hcVal < -0.2) p += 0.05;
    if (hcVal !== null && hcVal > 0.2) p -= 0.05;
    p = Math.min(Math.max(p, 0.2), 0.8);
    const homePct = Math.round(p * 100);
    if (Math.abs(homePct - (100 - homePct)) <= 8) return null;
    return homePct > 50 ? homeDbName : awayDbName;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeW, homeD, awayW, awayD, h2hMatches.length, h2hHomeW, h2hDraws, live.h1Home, live.h1Away, live.hcLines[0]?.home, homeDbName, awayDbName]);

  // Tokenize one line: highlight team names + numbers
  function renderLine(line: string, idx: number) {
    if (!line.trim()) return <div key={idx} className="h-2" />;

    const isHeader = /^[⚽🔄🎯📋]/.test(line);
    const isArrow = line.trim().startsWith('→');
    const isBracket = line.trim().startsWith('[');

    if (isHeader) {
      return (
        <div key={idx} className="text-[14px] font-extrabold text-white mt-3 first:mt-0 tracking-tight">
          {line}
        </div>
      );
    }

    const otherTeam = favoredTeam === homeDbName ? awayDbName : homeDbName;
    type Tok = { text: string; cls?: string };
    const tokens: Tok[] = [];
    let rem = line.trim();

    const namedPatterns: { str: string; cls: string }[] = [];
    if (favoredTeam) namedPatterns.push({ str: favoredTeam, cls: 'font-extrabold text-[#4ade80]' });
    if (otherTeam) namedPatterns.push({ str: otherTeam, cls: 'text-[#555] font-normal' });
    namedPatterns.sort((a, b) => b.str.length - a.str.length);

    while (rem.length > 0) {
      let found = false;
      for (const p of namedPatterns) {
        if (rem.startsWith(p.str)) {
          tokens.push({ text: p.str, cls: p.cls });
          rem = rem.slice(p.str.length);
          found = true;
          break;
        }
      }
      if (found) continue;

      const pct = rem.match(/^\d+%/);
      if (pct) {
        tokens.push({ text: pct[0], cls: 'font-extrabold text-[#fbbf24]' });
        rem = rem.slice(pct[0].length);
        continue;
      }

      const num = rem.match(/^\d+\.\d+/);
      if (num) {
        tokens.push({ text: num[0], cls: 'font-bold text-[#17a2b8]' });
        rem = rem.slice(num[0].length);
        continue;
      }

      const last = tokens.at(-1);
      if (last && !last.cls) last.text += rem[0];
      else tokens.push({ text: rem[0] });
      rem = rem.slice(1);
    }

    const wrapCls = isArrow
      ? 'text-[13px] text-[#fbbf24] pl-3 leading-relaxed'
      : isBracket
        ? 'text-[12px] text-[#666] leading-relaxed'
        : 'text-[13px] text-[#bbb] pl-3 leading-relaxed';

    return (
      <div key={idx} className={wrapCls}>
        {tokens.map((t, ti) =>
          t.cls ? <span key={ti} className={t.cls}>{t.text}</span> : t.text
        )}
      </div>
    );
  }

  function renderClaudeLine(line: string, idx: number) {
    const trimmed = line.trim();
    if (!trimmed) return <div key={idx} className="h-2" />;
    if (trimmed === '---' || trimmed === '***') return <hr key={idx} className="border-[#2a1a4a] my-2" />;

    // Inline parser: **bold**, team names, %, CÓ/KHÔNG, ~X%
    const inlineTokens = (text: string) => {
      const nodes: React.ReactNode[] = [];
      let rem = text;
      let ki = 0;
      const teamA = homeDbName;
      const teamB = awayDbName;
      while (rem.length > 0) {
        // **bold**
        const bold = rem.match(/^\*\*(.+?)\*\*/);
        if (bold) {
          nodes.push(<span key={ki++} className="font-bold text-white">{bold[1]}</span>);
          rem = rem.slice(bold[0].length);
          continue;
        }
        // team names
        if (teamA && rem.startsWith(teamA)) {
          nodes.push(<span key={ki++} className="font-extrabold text-[#4ade80]">{teamA}</span>);
          rem = rem.slice(teamA.length);
          continue;
        }
        if (teamB && rem.startsWith(teamB)) {
          nodes.push(<span key={ki++} className="font-extrabold text-[#f87171]">{teamB}</span>);
          rem = rem.slice(teamB.length);
          continue;
        }
        // ~X% or X-Y% or X%
        const pct = rem.match(/^~?\d+(?:[–-]\d+)?%/);
        if (pct) {
          nodes.push(<span key={ki++} className="font-extrabold text-[#fbbf24]">{pct[0]}</span>);
          rem = rem.slice(pct[0].length);
          continue;
        }
        // verdict words
        if (rem.startsWith('CÓ')) { nodes.push(<span key={ki++} className="font-bold text-[#4ade80]">CÓ</span>); rem = rem.slice(2); continue; }
        if (rem.startsWith('KHÔNG')) { nodes.push(<span key={ki++} className="font-bold text-[#f87171]">KHÔNG</span>); rem = rem.slice(5); continue; }
        if (rem.startsWith('THẮNG')) { nodes.push(<span key={ki++} className="font-bold text-[#fbbf24]">THẮNG</span>); rem = rem.slice(5); continue; }
        if (rem.startsWith('HÒA')) { nodes.push(<span key={ki++} className="font-bold text-[#a78bfa]">HÒA</span>); rem = rem.slice(3); continue; }
        // plain char
        if (typeof nodes.at(-1) === 'string') nodes[nodes.length - 1] = (nodes.at(-1) as string) + rem[0];
        else nodes.push(rem[0]);
        rem = rem.slice(1);
      }
      return nodes;
    };

    // # H1
    if (trimmed.startsWith('# ')) {
      return <div key={idx} className="text-[13px] font-extrabold text-[#a78bfa] mt-1 mb-1 tracking-tight">{inlineTokens(trimmed.slice(2))}</div>;
    }
    // ## H2 section
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const text = trimmed.replace(/^#{2,3}\s+/, '');
      return <div key={idx} className="text-[13px] font-extrabold text-white mt-3 first:mt-0 border-l-2 border-[#a78bfa] pl-2">{inlineTokens(text)}</div>;
    }
    // table separator
    if (/^\|[-:\s|]+\|$/.test(trimmed)) return <div key={idx} />;
    // table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
      return (
        <div key={idx} className="flex gap-2 text-[12px] py-0.5 border-b border-[#1a0a2a]/40">
          {cells.map((cell, ci) => (
            <div key={ci} className={ci === 0 ? 'w-[45%] text-[#888]' : 'flex-1 text-[#ccc]'}>
              {inlineTokens(cell)}
            </div>
          ))}
        </div>
      );
    }
    // list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <div key={idx} className="flex gap-1.5 text-[12px] text-[#bbb] leading-relaxed pl-1">
          <span className="text-[#a78bfa] flex-shrink-0 mt-0.5">·</span>
          <span>{inlineTokens(trimmed.slice(2))}</span>
        </div>
      );
    }
    // → arrow line
    if (trimmed.startsWith('→')) {
      return <div key={idx} className="text-[12px] text-[#fbbf24] pl-2 leading-relaxed">{inlineTokens(trimmed)}</div>;
    }
    // plain
    return <div key={idx} className="text-[12px] text-[#bbb] leading-relaxed">{inlineTokens(trimmed)}</div>;
  }

  async function triggerPrediction() {
    if (predAbortRef.current) predAbortRef.current.abort();
    const ctrl = new AbortController();
    predAbortRef.current = ctrl;
    setClaudePrediction('');
    setPythonStats('');
    setPredicting(true);

    // Fetch previous Claude predictions for this live match
    type PrevPred = { score_home: number; score_away: number; half: string | null; minute: number | null; prediction_text: string };
    let previousPredictions: PrevPred[] = [];
    try {
      if (live.eventId) {
        const histRes = await fetch(`/api/gs-claude-history?eventId=${live.eventId}`);
        if (histRes.ok) {
          const histJson = await histRes.json() as { ok: boolean; predictions?: PrevPred[] };
          previousPredictions = histJson.predictions ?? [];
          setPrevPredCount(previousPredictions.length);
        }
      }
    } catch { /* non-fatal */ }

    const homeAvgGoals = homeMatches.length
      ? homeMatches.reduce((s, m) => s + (m.homeTeam === homeDbName ? +m.ttHome : +m.ttAway), 0) / homeMatches.length
      : 0;
    const awayAvgGoals = awayMatches.length
      ? awayMatches.reduce((s, m) => s + (m.homeTeam === awayDbName ? +m.ttHome : +m.ttAway), 0) / awayMatches.length
      : 0;

    const body = JSON.stringify({
      homeTeam: homeDbName,
      awayTeam: awayDbName,
      h1Home: live.h1Home,
      h1Away: live.h1Away,
      isH2: live.isH2,
      minuteElapsed: live.minuteElapsed ?? 0,
      hcLine: live.hcLines[0]?.line ?? null,
      hcHome: live.hcLines[0]?.home ?? null,
      hcAway: live.hcLines[0]?.away ?? null,
      ouLine: live.ouLines[0]?.line ?? null,
      ouOver: live.ouLines[0]?.over ?? null,
      ouUnder: live.ouLines[0]?.under ?? null,
      hcH1Line: live.hcH1Lines[0]?.line ?? null,
      hcH1Home: live.hcH1Lines[0]?.home ?? null,
      hcH1Away: live.hcH1Lines[0]?.away ?? null,
      ouH1Line: live.ouH1Lines[0]?.line ?? null,
      ouH1Over: live.ouH1Lines[0]?.over ?? null,
      ouH1Under: live.ouH1Lines[0]?.under ?? null,
      eventId: live.eventId,
      matchType: live.matchType,
      redHome: live.redHome,
      redAway: live.redAway,
      yellowHome: live.yellowHome,
      yellowAway: live.yellowAway,
      cornersHome: live.cornersHome,
      cornersAway: live.cornersAway,
      homeAvgConceded: Math.round(homeAvgConceded * 10) / 10,
      awayAvgConceded: Math.round(awayAvgConceded * 10) / 10,
      homeHoldW, homeHoldTotal,
      awayHoldW, awayHoldTotal,
      homeW, homeD, homeL, homeAvgGoals,
      awayW, awayD, awayL, awayAvgGoals,
      h2hHomeW, h2hDraws, h2hAwayW, h2hTotal: h2hMatches.length,
      previousPredictions: previousPredictions.length > 0 ? previousPredictions : undefined,
    });
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal };

    try {
      // Parallel: Claude stream + Python stats
      const [claudeRes, pythonRes] = await Promise.all([
        fetch('/api/gs-predict', opts),
        fetch('/api/gs-predict?python=1', opts),
      ]);

      // Python stats — read all at once (no animation needed)
      if (pythonRes.ok && pythonRes.body) {
        const samples = pythonRes.headers.get('X-ML-Samples');
        if (samples) setMlSamples(Number(samples));
        pythonRes.text().then(t => { if (!ctrl.signal.aborted) setPythonStats(t); });
      }

      // Claude — stream with typing animation
      if (!claudeRes.body) return;
      const reader = claudeRes.body.getReader();
      const decoder = new TextDecoder();
      let fullClaudeText = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (ctrl.signal.aborted) break;
        const chunk = decoder.decode(value, { stream: true });
        fullClaudeText += chunk;
        setClaudePrediction(prev => prev + chunk);
      }

      // Save prediction after stream completes (fire-and-forget)
      if (fullClaudeText && live.eventId && !ctrl.signal.aborted) {
        fetch('/api/gs-claude-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: live.eventId,
            scoreHome: live.h1Home,
            scoreAway: live.h1Away,
            half: live.isH2 ? 'H2' : 'H1',
            minute: live.minuteElapsed ?? 0,
            predictionText: fullClaudeText,
          }),
        }).then(() => setPrevPredCount(c => c + 1)).catch(() => { /* non-fatal */ });
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) console.error('predict error', e);
    } finally {
      if (!ctrl.signal.aborted) setPredicting(false);
    }
  }

  // Detect goal → flash only (no auto-retrigger — manual refresh to save API tokens)
  useEffect(() => {
    const cur = `${live.h1Home}-${live.h1Away}`;
    if (cur !== prevScoreRef.current) {
      prevScoreRef.current = cur;
      setGoalFlash(true);
      setTimeout(() => setGoalFlash(false), 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.h1Home, live.h1Away]);

  // Auto-load once when tab first opens or matches finish loading — no repeat after that
  const triggerRef = useRef<() => void>(triggerPrediction);
  useEffect(() => { triggerRef.current = triggerPrediction; });
  useEffect(() => {
    if (activeTab !== 'suggest' || !matches) return;
    triggerRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, matches]);

  function DayBar({ stats, team }: { stats: DayStats[]; team: string }) {
    const { best, worst } = bestAndWorstDay(stats);
    const t = todayStats(stats);

    const cells = stats.map((s) => {
      const isToday = s.day === today;
      const bg = s.n === 0 ? '#1e1e1e' : s.winRate >= 65 ? '#16a34a' : s.winRate >= 50 ? '#d97706' : '#dc2626';
      const fg = s.n === 0 ? '#555' : s.winRate >= 65 ? '#4ade80' : s.winRate >= 50 ? '#fbbf24' : '#f87171';
      return (
        <div
          key={s.day}
          className={`flex flex-col items-center justify-center rounded text-center ${isToday ? 'ring-1 md:ring-2 ring-white' : ''}`}
          style={{ background: bg, color: fg }}
        >
          <span className="text-[8px] md:text-[9px] font-bold opacity-80">{s.label}</span>
          {s.n === 0 ? <span className="text-[9px] md:text-[10px]">—</span> : (
            <>
              <span className="text-[9px] md:text-[10px] font-bold">{s.winRate}%</span>
              <span className="hidden md:block text-[8px] opacity-60">n={s.n}</span>
            </>
          )}
        </div>
      );
    });

    return (
      <div>
        {/* Mobile: compact inline */}
        <div className="flex items-center gap-2 md:hidden">
          <div className="w-[56px] flex-shrink-0">
            <div className="text-[10px] font-semibold text-[#aaa] truncate leading-tight">{team}</div>
            {t && t.n > 0 && (
              <div className={`text-[10px] font-bold leading-tight ${t.winRate >= 50 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{t.winRate}%</div>
            )}
          </div>
          <div className="flex-1 grid grid-cols-7 gap-0.5">{cells}</div>
        </div>

        {/* Desktop: stacked with summary */}
        <div className="hidden md:block">
          <div className="mb-1 text-[11px] font-semibold text-[#aaa] truncate">{team}</div>
          <div className="grid grid-cols-7 gap-0.5 py-0.5">{cells}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
            {best && <span className="text-[#4ade80]">★ {best.label} {best.winRate}%</span>}
            {worst && <span className="text-[#f87171]">✗ {worst.label} {worst.winRate}%</span>}
            {t && t.n > 0 && <span className="text-[#aaa]">Hôm nay: {t.winRate}% {t.winRate >= 50 ? '↑' : '↓'}</span>}
          </div>
        </div>
      </div>
    );
  }

  function FormList({ recentMatches, team }: { recentMatches: Match[]; team: string }) {
    if (!recentMatches.length) return <div className="text-[11px] text-[#555] py-1">Không có dữ liệu</div>;
    return (
      <div className="flex flex-col divide-y divide-[#1e1e1e]">
        {recentMatches.map((m, i) => {
          const isHome = m.homeTeam === team;
          const opp = isHome ? m.awayTeam : m.homeTeam;
          const res = resultFor(m, team);
          const myTT = isHome ? m.ttHome : m.ttAway;
          const opTT = isHome ? m.ttAway : m.ttHome;
          return (
            <div key={i} className="py-1 md:py-1.5 flex items-center gap-1">
              <span className="text-[9px] text-[#555] flex-shrink-0">{isHome ? '🏠' : '✈️'}</span>
              <span className="text-[10px] md:text-[10px] text-[#bbb] truncate flex-1 min-w-0">{opp}</span>
              <span className="text-[10px] font-bold text-white flex-shrink-0 tabular-nums">{myTT}-{opTT}</span>
              <ResultTag result={res} />
            </div>
          );
        })}
      </div>
    );
  }

  function H2HList({ h2h }: { h2h: Match[] }) {
    if (!h2h.length) return <div className="text-[11px] text-[#555]">Chưa có dữ liệu đối đầu</div>;
    return (
      <div className="flex flex-col divide-y divide-[#1e1e1e]">
        {h2h.map((m, i) => {
          const ih = m.homeTeam === homeDbName;
          const homeScore = +m.ttHome;
          const awayScore = +m.ttAway;
          const winner = homeScore > awayScore ? m.homeTeam : awayScore > homeScore ? m.awayTeam : null;
          // H/A relative to the H2H match itself (home/away of displayed row), color relative to live match
          const h2hLabel = winner === null ? 'D' : winner === m.homeTeam ? 'H' : 'A';
          const wCls = winner === homeDbName ? 'text-[#4ade80]' : winner === awayDbName ? 'text-[#f87171]' : winner === null ? 'text-[#fbbf24]' : 'text-[#aaa]';
          return (
            <div key={i} className="flex items-center gap-1.5 md:gap-2 py-1 md:py-1.5 text-[11px]">
              <span className="w-[56px] md:w-[72px] flex-shrink-0 text-[10px] text-[#555] tabular-nums">{m.date}</span>
              <span className="text-[10px]">{ih ? '🏠' : '✈️'}</span>
              <span className="flex-1 min-w-0 text-[#bbb] truncate">
                {m.homeTeam} <span className="text-[#444]">vs</span> {m.awayTeam}
              </span>
              <span className="hidden md:inline text-[10px] text-[#555] tabular-nums">H1 {m.h1Home}-{m.h1Away}</span>
              <span className="font-bold text-white tabular-nums">{m.ttHome}-{m.ttAway}</span>
              <span className={`font-bold ${wCls}`}>{h2hLabel}</span>
              <TypeBadge type={m.matchType} />
            </div>
          );
        })}
      </div>
    );
  }

  function PredictCard() {
    const homeFormPts = homeW * 3 + homeD;
    const awayFormPts = awayW * 3 + awayD;
    const totalFormPts = homeFormPts + awayFormPts;

    let homeP = totalFormPts > 0 ? homeFormPts / totalFormPts : 0.5;
    if (h2hMatches.length > 0) {
      const h2hRatio = (h2hHomeW + h2hDraws * 0.5) / h2hMatches.length;
      homeP = homeP * 0.7 + h2hRatio * 0.3;
    }
    const scoreDiff = live.h1Home - live.h1Away;
    if (scoreDiff > 0) homeP -= 0.08;
    if (scoreDiff < 0) homeP += 0.08;
    const hcVal = live.hcLines[0]?.home ? parseFloat(live.hcLines[0].home) : null;
    if (hcVal !== null && hcVal < -0.2) homeP += 0.05;
    if (hcVal !== null && hcVal > 0.2) homeP -= 0.05;
    homeP = Math.min(Math.max(homeP, 0.2), 0.8);

    const homePct = Math.round(homeP * 100);
    const awayPct = 100 - homePct;
    const homeLeads = homePct > awayPct;
    const isBalanced = Math.abs(homePct - awayPct) <= 8;

    const Dots = ({ w, d, l }: { w: number; d: number; l: number }) => {
      const MAX = 10;
      const total = w + d + l;
      const scale = total > MAX ? MAX / total : 1;
      const sw = Math.max(0, Math.round(w * scale));
      const sl = Math.max(0, Math.round(l * scale));
      const sd = Math.max(0, Math.min(Math.round(d * scale), MAX - sw - sl));
      return (
        <div className="flex gap-1">
          {Array.from({ length: sw }, (_, i) => <span key={`w${i}`} className="w-2.5 h-2.5 rounded-full bg-[#4ade80] inline-block" />)}
          {Array.from({ length: sd }, (_, i) => <span key={`d${i}`} className="w-2.5 h-2.5 rounded-full bg-[#fbbf24] inline-block" />)}
          {Array.from({ length: sl }, (_, i) => <span key={`l${i}`} className="w-2.5 h-2.5 rounded-full bg-[#f87171] inline-block" />)}
        </div>
      );
    };

    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2">
        {/* Compact header row */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] text-[#555] font-bold uppercase tracking-wide">⚽ Ghi bàn tiếp</span>
          {!isBalanced && (
            <span className={`text-[11px] font-extrabold ${homeLeads ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {homeLeads ? homeDbName : awayDbName} ưu thế
            </span>
          )}
          {isBalanced && <span className="text-[11px] text-[#fbbf24] font-bold">Cân bằng</span>}
          {live.hcLines[0]?.line && (
            <span className="ml-auto text-[11px] text-[#fbbf24] font-bold">HC {live.hcLines[0].line}</span>
          )}
        </div>

        {/* % bar + form dots in one row */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[20px] font-black leading-none flex-shrink-0 ${homeLeads && !isBalanced ? 'text-[#4ade80]' : 'text-[#666]'}`}>{homePct}%</span>
          <div className="flex-1 flex rounded-full overflow-hidden h-2">
            <div style={{ width: `${homePct}%` }} className={`transition-all duration-500 ${homeLeads ? 'bg-[#4ade80]' : 'bg-[#333]'}`} />
            <div style={{ width: `${awayPct}%` }} className={`transition-all duration-500 ${!homeLeads ? 'bg-[#f87171]' : 'bg-[#333]'}`} />
          </div>
          <span className={`text-[20px] font-black leading-none flex-shrink-0 ${!homeLeads && !isBalanced ? 'text-[#f87171]' : 'text-[#666]'}`}>{awayPct}%</span>
        </div>

        {/* Form dots */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Dots w={homeW} d={homeD} l={homeL} />
          </div>
          <span className="text-[10px] text-[#444] flex-1">vs</span>
          <div className="flex items-center gap-1">
            <Dots w={awayW} d={awayD} l={awayL} />
          </div>
          {h2hMatches.length > 0 && (
            <span className="text-[10px] text-[#555] flex-shrink-0">H2H {h2hHomeW}-{h2hDraws}-{h2hAwayW}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] w-full md:w-[680px] bg-[#111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
        {/* Header + Teams */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#222] flex-shrink-0 bg-[#0d0d0d]">
          <span className="text-[13px] font-bold text-[#fbbf24]">📊</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-bold text-white truncate">
                {live.homeTeam} <span className="text-[#555] font-normal">vs</span> {live.awayTeam}
              </span>
              <span className="text-[13px] font-extrabold text-[#fbbf24] tabular-nums">
                {live.h1Home}–{live.h1Away}
              </span>
              <span className="text-[11px] font-semibold text-[#4ade80]">
                {live.isH2 ? 'H2' : 'H1'} {live.minuteElapsed ?? 0}&apos;
              </span>
            </div>
            <div className="text-[10px] text-[#555] mt-0.5">
              {!loading && matches ? `${matches.length} trận trong DB` : 'Đang tải…'}
            </div>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white text-lg leading-none flex-shrink-0">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-2 border-b border-[#1a1a1a] flex-shrink-0 bg-[#0d0d0d]">
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-t border-b-2 transition-colors ${activeTab === 'stats' ? 'text-white border-[#fbbf24]' : 'text-[#666] border-transparent hover:text-[#aaa]'}`}
          >
            📊 Thống kê
          </button>
          <button
            onClick={() => setActiveTab('suggest')}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-t border-b-2 transition-colors ${activeTab === 'suggest' ? 'text-white border-[#4ade80]' : 'text-[#666] border-transparent hover:text-[#aaa]'}`}
          >
            💡 Gợi ý
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-[#666] text-[13px]">Đang tải dữ liệu…</div>
          )}

          {!loading && matches !== null && activeTab === 'stats' && (
            <div className="flex flex-col gap-0">
              {/* Section: Phong độ theo ngày */}
              <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">
                  📅 Phong độ theo ngày · Hôm nay: {todayLabel}
                </div>
                <div className="flex flex-col gap-1.5 md:gap-4">
                  <DayBar stats={homeDayStats} team={homeDbName} />
                  <DayBar stats={awayDayStats} team={awayDbName} />
                </div>
              </div>

              {/* Section: 5 trận — 2 col side by side */}
              <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">📋 5 trận gần nhất</div>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <div>
                    <div className="mb-1 md:mb-1.5 text-[10px] font-semibold text-[#aaa] truncate">{homeDbName}</div>
                    <FormList recentMatches={homeMatches} team={homeDbName} />
                  </div>
                  <div>
                    <div className="mb-1 md:mb-1.5 text-[10px] font-semibold text-[#aaa] truncate">{awayDbName}</div>
                    <FormList recentMatches={awayMatches} team={awayDbName} />
                  </div>
                </div>
              </div>

              {/* Section: H2H full width */}
              <div className="px-3 py-3 md:px-4 md:py-4">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">⚔️ 5 trận đối đầu</div>
                <H2HList h2h={h2hMatches} />
              </div>
            </div>
          )}

          {!loading && matches !== null && activeTab === 'suggest' && (
            <div className="px-4 py-4 space-y-3">
              {goalFlash && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fbbf24] text-[12px] font-bold animate-pulse">
                  ⚽ Bàn thắng! Đang cập nhật phân tích…
                </div>
              )}
              {/* Shared visual card */}
              <PredictCard />

              {/* Boxes: desktop = 2-col grid | mobile = swipe carousel */}
              <div
                ref={carouselRef}
                onScroll={() => {
                  if (!carouselRef.current) return;
                  const { scrollLeft, offsetWidth } = carouselRef.current;
                  setActiveDot(scrollLeft > offsetWidth * 0.5 ? 1 : 0);
                }}
                className="flex overflow-x-auto snap-x snap-mandatory gap-3 md:flex-col md:overflow-visible md:snap-none"
                style={{ scrollbarWidth: 'none' }}
              >
                {/* Claude box */}
                <div className={`snap-start shrink-0 w-full rounded-xl border bg-[#0f0a1a] overflow-hidden transition-all duration-300 ${goalFlash ? 'border-[#fbbf24]/60' : 'border-[#2a1a4a]'}`}>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a1a4a]">
                    <span className="text-[12px] font-extrabold text-[#a78bfa]">✨ Claude</span>
                    {predicting && !claudePrediction && <span className="text-[10px] text-[#fbbf24] animate-pulse ml-1">đang phân tích…</span>}
                    {prevPredCount > 0 && !predicting && (
                      <span className="text-[10px] text-[#a78bfa]/50 font-semibold" title="Số dự đoán đã lưu trong trận này">
                        📚 {prevPredCount}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-[10px] text-[#3a2a5a] font-semibold">Haiku</span>
                      {!predicting && (
                        <button
                          onClick={triggerPrediction}
                          className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1a0a3a] border border-[#4a2a7a] text-[#a78bfa] hover:bg-[#221040] active:scale-95 transition-all text-[16px] leading-none"
                          title="Làm mới dự đoán"
                        >↺</button>
                      )}
                    </div>
                  </div>
                  <div className="px-3 py-2.5">
                    {!claudePrediction && !predicting && <div className="text-[13px] text-[#555]">Đang tải…</div>}
                    {claudePrediction && (
                      <div className="space-y-0.5">
                        {claudePrediction.split('\n').map((line, i) => renderClaudeLine(line, i))}
                        {predicting && <span className="inline-block w-1.5 h-3.5 bg-[#a78bfa] ml-0.5 animate-pulse align-middle" />}
                      </div>
                    )}
                  </div>
                </div>

                {/* Python box */}
                <div className={`snap-start shrink-0 w-full rounded-xl border bg-[#0a1a0a] overflow-hidden transition-all duration-300 ${goalFlash ? 'border-[#fbbf24]/60' : 'border-[#1a3a1a]'}`}>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a3a1a]">
                    <span className="text-[12px] font-extrabold text-[#4ade80]">🤖 Python ML</span>
                    {predicting && !pythonStats && <span className="text-[10px] text-[#fbbf24] animate-pulse ml-1">đang tính…</span>}
                    <span className="ml-auto text-[10px] text-[#2a4a2a] font-semibold">ML{mlSamples ? ` · ${mlSamples} mẫu` : ''}</span>
                  </div>
                  <div className="px-3 py-2.5">
                    {!pythonStats && !predicting && <div className="text-[13px] text-[#555]">Đang tải…</div>}
                    {pythonStats && (
                      <div className="space-y-0.5">
                        {pythonStats.split('\n').map((line, i) => renderLine(line, i))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mobile dot indicators */}
              <div className="flex justify-center gap-2 md:hidden">
                <button
                  onClick={() => carouselRef.current?.scrollTo({ left: 0, behavior: 'smooth' })}
                  className={`h-2 rounded-full transition-all duration-300 ${activeDot === 0 ? 'w-5 bg-[#a78bfa]' : 'w-2 bg-[#333]'}`}
                />
                <button
                  onClick={() => carouselRef.current?.scrollTo({ left: carouselRef.current.offsetWidth, behavior: 'smooth' })}
                  className={`h-2 rounded-full transition-all duration-300 ${activeDot === 1 ? 'w-5 bg-[#4ade80]' : 'w-2 bg-[#333]'}`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SimilarMatchesDrawer({ live, onClose }: { live: GsLiveMatch; onClose: () => void }) {
  const [matches, setMatches] = useState<AnalysisMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMatches(null);
    const urlAB =
      `/api/match-analysis?homeTeam=${encodeURIComponent(live.homeTeam)}` +
      `&awayTeam=${encodeURIComponent(live.awayTeam)}`;
    const urlBA =
      `/api/match-analysis?homeTeam=${encodeURIComponent(live.awayTeam)}` +
      `&awayTeam=${encodeURIComponent(live.homeTeam)}`;
    Promise.all([fetch(urlAB).then((r) => r.json()), fetch(urlBA).then((r) => r.json())])
      .then(([jsonAB, jsonBA]: [{ ok: boolean; matches?: AnalysisMatch[] }, { ok: boolean; matches?: AnalysisMatch[] }]) => {
        if (!alive) return;
        const list = [...(jsonAB.matches ?? []), ...(jsonBA.matches ?? [])]
          .filter((g) => g.eventId !== live.eventId)
          .sort((a, b) => {
            const aT = a.snapshots.at(-1)?.recordedAt ?? '';
            const bT = b.snapshots.at(-1)?.recordedAt ?? '';
            return bT.localeCompare(aT);
          });
        setMatches(list);
      })
      .catch(() => { if (alive) setMatches([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [live.eventId, live.homeTeam, live.awayTeam]);

  const snapLabel: Record<string, string> = {
    first_seen: 'Bắt đầu',
    kickoff_h1: 'KO H1',
    kickoff_h2: 'KO H2',
    goal_h1: 'Bàn H1',
    goal_h2: 'Bàn H2',
  };

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] w-full md:w-[460px] bg-[#111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#222] flex-shrink-0">
          <span className="text-[13px] font-bold text-white">🔍 Lịch sử đối đầu</span>
          <button onClick={onClose} className="ml-auto text-[#555] hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Teams header */}
        <div className="px-4 py-2.5 border-b border-[#1a1a1a] flex-shrink-0 bg-[#0d0d0d]">
          <div className="text-[12px] font-semibold text-white">
            {live.homeTeam} <span className="text-[#555] font-normal">vs</span> {live.awayTeam}
          </div>
          <div className="text-[10px] text-[#555] mt-0.5">
            {!loading && matches ? `${matches.length} trận trong DB` : 'Đang tìm…'}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[#666] text-[13px]">Đang tìm kiếm…</div>
          )}
          {!loading && matches?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <span className="text-3xl">📭</span>
              <span className="text-[13px] text-[#666]">Chưa có lịch sử đối đầu trong DB</span>
            </div>
          )}
          {!loading && matches && matches.length > 0 && (
            <div className="flex flex-col divide-y divide-[#1a1a1a]">
              {matches.map((g) => {
                const isExpanded = expandedId === g.eventId;
                return (
                  <div key={g.eventId} className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold text-[#fbbf24]">
                            {g.finalScore.home}–{g.finalScore.away}
                          </span>
                          <span className="text-[10px] text-[#555]">
                            {g.matchDate ?? '—'} · {g.matchType ?? ''}
                          </span>
                          {g.homeTeam !== live.homeTeam && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-[#1e3a5f]/40 text-[#60a5fa] border border-[#60a5fa]/30">đảo</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#666] mt-0.5">
                          {g.snapshots.length} snapshots
                          {g.snapshots[0]?.hcLine && <span className="ml-2">HC {g.snapshots[0].hcLine}</span>}
                          {g.snapshots[0]?.ouLine && <span className="ml-2">OU {g.snapshots[0].ouLine}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : g.eventId)}
                        className="flex-shrink-0 text-[#555] hover:text-white text-sm transition-colors"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>

                    {/* Snapshot timeline */}
                    {isExpanded && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        {g.snapshots.map((s, idx) => (
                          <div
                            key={idx}
                            className="rounded-md px-2.5 py-1.5 text-[11px] border bg-[#141414] border-[#222]"
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-semibold text-[#888]">
                                {snapLabel[s.snapshotType] ?? s.snapshotType}
                              </span>
                              <span className="text-[#fbbf24] font-bold">{s.scoreHome}–{s.scoreAway}</span>
                              {s.hcLine && (
                                <span className="text-[#aaa]">HC {s.hcLine} · {s.hcHomeOdds ?? '—'}/{s.hcAwayOdds ?? '—'}</span>
                              )}
                              {s.ouLine && (
                                <span className="text-[#aaa]">OU {s.ouLine} · {s.ouOver ?? '—'}/{s.ouUnder ?? '—'}</span>
                              )}
                              {s.hcH1Line && (
                                <span className="text-[#60a5fa]/70">HC H1 {s.hcH1Line}</span>
                              )}
                              {s.ouH1Line && (
                                <span className="text-[#60a5fa]/70">OU H1 {s.ouH1Line}</span>
                              )}
                            </div>
                          </div>
                        ))}
                        <div className="mt-1 text-[10px] text-[#555]">
                          Kết quả: {g.finalScore.home}–{g.finalScore.away}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
