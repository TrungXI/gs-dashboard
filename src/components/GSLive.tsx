'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Match } from '../types/match';
import { resultFor } from '../lib/stats';
import { notiOnce } from '../lib/notiDedup';
import { todayDayOfWeek, todayStats, bestAndWorstDay, DAY_LABELS_FULL, type DayStats } from '../lib/dayStats';
import { TypeBadge, ResultTag } from './badges';
import { LoadingState } from './Spinner';
import MatchAnalysis from './MatchAnalysis';
import MatchupView from './MatchupView';
import HcWatchDrawer from './HcWatchDrawer';
import H1StatsPanel from './H1StatsPanel';
import SearchDropdown from './SearchDropdown';
import type { GsBetsResponse } from '../app/api/gs-bets/route';
import type { GsPickLite } from '../app/api/gs-picks/route';
import type { GsTeamHistoryResponse, GsTeamHistoryRow } from '../app/api/gs-team-history/route';
import type { TeamAnalysisAgg } from '../app/api/gs-team-analysis/route';
import type { PairResult } from '../app/api/gs-h2h-splits/route';


export interface GsLiveMatch {
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
  oddsH1Home: number | null;
  oddsH1Away: number | null;
  oddsH1Draw: number | null;
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

export interface Toast {
  id: number;
  kind: 'goal' | 'halftime';
  message: string;
}

const GREEN = '#4ade80';
const BLUE = '#60a5fa';
const ORANGE = '#fb923c';

// Row accent line (GS Live match rows) — MỘT line duy nhất, đổi màu theo trạng thái.
// Ưu tiên: đã có chỉ số H1 (gs_ht_stats) → VÀNG; nếu chưa mà đang Hiệp 2 → XANH; else không có.
const ACCENT_GREEN = '#4ade80';  // Hiệp 2 (isH2) nhưng CHƯA có chỉ số H1
const ACCENT_YELLOW = '#fbbf24'; // đã có chỉ số H1 (hasStats) — thay thế xanh

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

export function phaseLabel(m: GsLiveMatch, nowMs: number): string {
  if (!m.isLive) {
    return nowMs < new Date(m.startTime).getTime() ? 'Chờ' : 'KT';
  }
  // period: 2=H1 live, 4=Halftime, 8=H2 live (ev['10'])
  if (m.period === 4) return 'Nghỉ HT';
  const min = m.minuteElapsed ?? 0;
  if (m.isH2) return `2H ${min}'`;
  return `1H ${min}'`;
}

export default function GSLive({ initialMatch }: { initialMatch?: number | null } = {}) {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
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
  // Toast in-app: bật/tắt popup. Mặc định BẬT (chỉ tắt khi localStorage = '0').
  const [toastOn, setToastOn] = useState(true);
  const toastOnRef = useRef(true);
  const [loadTs] = useState(() => Date.now());
  const [globalReloadKey, setGlobalReloadKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoStream, setAutoStream] = useState(false);
  const [analysisMatchId, setAnalysisMatchId] = useState<number | null>(null);
  const [hcWatchMatchId, setHcWatchMatchId] = useState<number | null>(null);
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);
  // Trận đã có chỉ số H1 (ảnh HT chụp + OCR ra số → row trong gs_ht_stats). Dùng cho accent VÀNG.
  const [hasStatsSet, setHasStatsSet] = useState<Set<number>>(new Set());
  // Đối đầu H1/H2 (gs_matches_history) — batch theo cặp đội, refresh chậm (5 phút).
  const [h2hMap, setH2hMap] = useState<Map<string, PairResult>>(new Map());


  useEffect(() => {
    setAutoStream(localStorage.getItem('gs_auto_stream') === '1');
  }, []);

  useEffect(() => {
    const g = localStorage.getItem('gs_os_noti_goal') === '1';
    const h = localStorage.getItem('gs_os_noti_ht') === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h);   osNotiHTRef.current = h;
    const t = localStorage.getItem('gs_toast_live') !== '0';
    setToastOn(t); toastOnRef.current = t;
  }, []);

  useEffect(() => { osNotiGoalRef.current = osNotiGoal; }, [osNotiGoal]);
  useEffect(() => { osNotiHTRef.current = osNotiHT; }, [osNotiHT]);
  useEffect(() => { toastOnRef.current = toastOn; }, [toastOn]);

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
    if (eventId != null && !notiOnce(`${kind}:${eventId}:${body.split('\n')[0]}`)) return; // chống noti trùng (nhiều nguồn/race)
    const n = new Notification(title, { body, silent: false });
    if (eventId != null) {
      n.onclick = () => {
        window.focus();
        document.querySelector(`[data-event-id="${eventId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    }
  }

  function pushToast(kind: Toast['kind'], message: string) {
    if (!toastOnRef.current) return; // toast đang tắt
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
      // 4G: ngừng poll khi tab ẩn / màn tắt — TRỪ khi user đã bật noti (ghi bàn / hết H1):
      // noti chỉ bắn TRONG poll, nên tab ẩn mà vẫn muốn noti thì buộc phải poll nền (chấp nhận tốn pin).
      if (typeof document !== 'undefined' && document.hidden && !osNotiGoalRef.current && !osNotiHTRef.current) return;
      try {
        const res = await fetch(`/api/gs-live?token=${encodeURIComponent(GS_STREAM_TOKEN)}`, {
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
              notifyOS('goal', `⚽ ${nm.homeTeam} ghi bàn!`, `${nm.homeTeam}  ${nm.h1Home} – ${nm.h1Away}  ${nm.awayTeam}\n${matchTime}`, nm.eventId);
            }
            if (nm.h1Away > pm.h1Away) {
              newScored.add(nm.eventId);
              pushToast('goal', `⚽ ${nm.awayTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away} · ${matchTime}`);
              notifyOS('goal', `⚽ ${nm.awayTeam} ghi bàn!`, `${nm.homeTeam}  ${nm.h1Home} – ${nm.h1Away}  ${nm.awayTeam}\n${matchTime}`, nm.eventId);
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
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    }

    if (!autoRefresh) return () => { alive = false; };
    poll();
    // 4G: trên Vercel (prod) poll 5s; local dev giữ 2s để test nhanh.
    const POLL_MS = typeof window !== 'undefined' && !/localhost|127\.0\.0\.1/.test(window.location.hostname) ? 5000 : 2000;
    const id = setInterval(poll, POLL_MS);
    const onVis = () => { if (!document.hidden) poll(); }; // quay lại tab → refresh ngay
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [autoRefresh]);

  const activeToken = GS_STREAM_TOKEN;

  const eventIdsKey = matches.map((m) => m.eventId).sort((a, b) => a - b).join(',');

  // Chỉ số H1 (gs_ht_stats) — poll 15s (chậm hơn odds vì chỉ số không đổi nhanh). Chỉ cần biết eventId nào đã có row.
  useEffect(() => {
    if (!eventIdsKey) { setHasStatsSet(new Set()); return; }
    let alive = true;
    async function loadHasStats() {
      if (typeof document !== 'undefined' && document.hidden) return; // 4G: ngừng khi tab ẩn
      try {
        const res = await fetch(`/api/gs-has-stats?eventIds=${eventIdsKey}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; eventIds?: number[] };
        if (!alive || !json.ok) return;
        setHasStatsSet(new Set(json.eventIds || []));
      } catch {
        /* giữ set cũ khi lỗi mạng tạm thời */
      }
    }
    loadHasStats();
    const id = setInterval(loadHasStats, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [eventIdsKey]);

  // Đối đầu H1/H2 — key ổn định theo TẬP cặp đội đang hiển thị (KHÔNG phụ thuộc odds tick).
  // Chỉ đổi khi danh sách cặp đội đổi → effect không re-fire theo poll 2s.
  const pairsKey = Array.from(new Set(matches.map((m) => `${m.homeTeam}|${m.awayTeam}`))).sort().join(',');
  useEffect(() => {
    if (!pairsKey) { setH2hMap(new Map()); return; }
    let alive = true;
    async function loadH2H() {
      if (typeof document !== 'undefined' && document.hidden) return; // 4G: ngừng khi tab ẩn
      try {
        // Encode team names but keep the , (pair sep) and | (A|B sep) literal so the server splits correctly.
        const pairsParam = pairsKey
          .split(',')
          .map((pair) => pair.split('|').map(encodeURIComponent).join('|'))
          .join(',');
        const res = await fetch(`/api/gs-h2h-splits?pairs=${pairsParam}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; pairs?: PairResult[] };
        if (!alive || !json.ok || !json.pairs) return;
        setH2hMap(new Map(json.pairs.map((p) => [`${p.teamA}|${p.teamB}`, p])));
      } catch {
        /* giữ map cũ khi lỗi mạng tạm thời */
      }
    }
    loadH2H();
    const id = setInterval(loadH2H, 300_000); // 5 phút — lịch sử đổi chậm
    return () => { alive = false; clearInterval(id); };
  }, [pairsKey]);

  // Deep-link: when the requested match appears in the live list, open its
  // analysis drawer once. If the event never goes live it simply won't open
  // (LiveAnalysisDrawer needs the full live odds/phase object) — no crash.
  const deepLinkOpenedFor = useRef<number | null>(null);
  useEffect(() => {
    if (initialMatch == null || !Number.isFinite(initialMatch)) return;
    if (deepLinkOpenedFor.current === initialMatch) return;
    if (matches.some((m) => m.eventId === initialMatch)) {
      deepLinkOpenedFor.current = initialMatch;
      setAnalysisMatchId(initialMatch);
    }
  }, [initialMatch, matches]);

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
        {/* ⚽ Ghi bàn + 🔔 Hết H1 noti — đưa lên cạnh Auto */}
        <button
          type="button"
          onClick={() => {
            if (osNotiGoal) { setOsNotiGoal(false); osNotiGoalRef.current = false; localStorage.setItem('gs_os_noti_goal', '0'); }
            else requestAndSet('gs_os_noti_goal', setOsNotiGoal, osNotiGoalRef);
          }}
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${osNotiGoal ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
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
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${osNotiHT ? 'border-[#fbbf24]/40 text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={osNotiHT ? 'Tắt noti hết H1' : 'Bật noti hết H1 ra Macbook'}
        >
          {osNotiHT ? '🔔 Hết H1 ON' : '🔔 Hết H1 OFF'}
        </button>
        {/* Bật/tắt toast popup trong app */}
        <button
          type="button"
          onClick={() => {
            const next = !toastOn;
            setToastOn(next); toastOnRef.current = next;
            localStorage.setItem('gs_toast_live', next ? '1' : '0');
          }}
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${toastOn ? 'border-[#17a2b8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={toastOn ? 'Tắt toast popup trong app' : 'Bật toast popup trong app'}
        >
          {toastOn ? '💬 Toast ON' : '🔕 Toast OFF'}
        </button>
        {/* Nút Stream thủ công/tự động — tạm ẩn, bật lại khi cần dùng video */}
        {/* Indicator "⟳ 2s · giờ" đã bỏ hiển thị theo yêu cầu — polling vẫn chạy ngầm bình thường */}
      </div>

      {(() => {
        const anaLive = analysisMatchId != null ? matches.find(m => m.eventId === analysisMatchId) ?? null : null;
        const hcLive = hcWatchMatchId != null ? matches.find(m => m.eventId === hcWatchMatchId) ?? null : null;
        return (
          <>
            {anaLive && <LiveAnalysisDrawer live={anaLive} onClose={() => setAnalysisMatchId(null)} />}
            {hcLive && <HcWatchDrawer home={hcLive.homeTeam} away={hcLive.awayTeam} onClose={() => setHcWatchMatchId(null)} />}
          </>
        );
      })()}

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
            hasStatsSet={hasStatsSet}
            h2hMap={h2hMap}
            prevMap={prevMap}
            scoredIds={scoredIds}
            nowMs={nowMs}
            loadTs={loadTs}
            activeToken={activeToken}
            globalReloadKey={globalReloadKey}
            h1Finals={h1Finals}
            autoStream={autoStream}
            onAnalysis={(m) => setAnalysisMatchId(m.eventId)}
            onHcWatch={(m) => setHcWatchMatchId(m.eventId)}
            activeMatchId={analysisMatchId}
          />
          <LeagueSection
            title="Giao Hữu Châu Á GS (Ảo) 20 Phút"
            matches={matches.filter((m) => m.leagueId === 2125)}
            hasStatsSet={hasStatsSet}
            h2hMap={h2hMap}
            prevMap={prevMap}
            scoredIds={scoredIds}
            nowMs={nowMs}
            loadTs={loadTs}
            activeToken={activeToken}
            globalReloadKey={globalReloadKey}
            h1Finals={h1Finals}
            autoStream={autoStream}
            onAnalysis={(m) => setAnalysisMatchId(m.eventId)}
            onHcWatch={(m) => setHcWatchMatchId(m.eventId)}
            activeMatchId={analysisMatchId}
          />
        </>
      )}
    </>
  );
}

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast-item pointer-events-auto flex items-center gap-2 rounded-xl pl-4 pr-2 py-2.5 text-[13px] font-semibold shadow-2xl select-none whitespace-nowrap ${
            t.kind === 'goal'
              ? 'bg-[#14532d]/95 border border-[#22c55e]/50 text-[#bbf7d0]'
              : 'bg-[#78350f]/95 border border-[#fbbf24]/60 text-[#fef3c7]'
          }`}
        >
          <span>{t.message}</span>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onDismiss(t.id)}
            className="ml-1 shrink-0 grid place-items-center h-5 w-5 rounded-full text-[13px] leading-none opacity-70 hover:opacity-100 hover:bg-white/15 transition"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

const TABLE_HEADERS = ['#', 'Trận đấu', 'Tỉ số / Phase', 'Kèo Chấp TT', 'Tài Xỉu TT', 'Kèo Chấp H1', 'Tài Xỉu H1'];

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

// Đối đầu (lịch sử H2H): 1 DÒNG TEXT gọn / hiệp. `ĐĐ H1: A 45% · Hoà 25% · B 30% (n35)`
// A xanh / hòa xám / B hồng, n mẫu mỏng (<8) → vàng cảnh báo. Dùng cả desktop lẫn mobile.
export function H2HLine({
  label, s, meetings,
}: {
  label: string;
  s: { aWinPct: number; drawPct: number; bWinPct: number };
  meetings: number;
}) {
  const thin = meetings < 8;
  return (
    <div className="text-[10px] leading-tight whitespace-nowrap">
      <span className="text-[#777]">ĐĐ {label}: </span>
      <span className="text-[#4ade80]">A {s.aWinPct}%</span>
      <span className="text-[#555]"> · </span>
      <span className="text-[#888]">Hoà {s.drawPct}%</span>
      <span className="text-[#555]"> · </span>
      <span className="text-[#fb7185]">B {s.bWinPct}%</span>
      <span className={`ml-1 font-bold ${thin ? 'text-[#fbbf24]' : 'text-[#666]'}`}>(n{meetings})</span>
    </div>
  );
}

// Hai dòng: H1 split ở trên, H2 split ở dưới. Không loaded → `…`; n=0 → ẩn (muted "—").
export function H2HLines({ splits, className }: { splits?: PairResult; className?: string }) {
  if (!splits) return <div className={`text-[10px] text-[#555] ${className ?? ''}`}>ĐĐ …</div>;
  if (splits.meetings === 0) return <div className={`text-[10px] text-[#555] ${className ?? ''}`}>ĐĐ —</div>;
  return (
    <div className={className}>
      <H2HLine label="H1" s={splits.h1} meetings={splits.meetings} />
      <H2HLine label="H2" s={splits.h2} meetings={splits.meetings} />
    </div>
  );
}

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

// Token lấy từ env (NEXT_PUBLIC_GS_TOKEN) — không còn nhập tay trên UI.
const GS_STREAM_TOKEN = process.env.NEXT_PUBLIC_GS_TOKEN ?? '';

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

// Ô Kèo — thay chỗ VideoCell trong list. Trận không có pick → không render gì.
const CONF_ICON: Record<string, string> = { Cao: '🟥', TB: '🟨', Thấp: '🟦' };
function PickCell({ pick }: { pick?: GsPickLite }) {
  if (!pick) return null;
  const hasSide = pick.side_pick && pick.side_pick !== 'BỎ';
  const hasOu = pick.ou_pick && pick.ou_pick !== 'BỎ';
  const confIcon = pick.confidence ? (CONF_ICON[pick.confidence] ?? '⬜') : null;
  const { hc, ou } = parseVerdictReasons(pick.verdict ?? null);
  const statParts: string[] = [];
  if (pick.home_shots != null || pick.away_shots != null) statParts.push(`Sút ${pick.home_shots ?? '?'}/${pick.away_shots ?? '?'}`);
  if (pick.home_poss != null || pick.away_poss != null) statParts.push(`KS ${pick.home_poss ?? '?'}/${pick.away_poss ?? '?'}`);
  if (pick.home_xg != null || pick.away_xg != null) statParts.push(`Cơ hội ${pick.home_xg ?? '?'}/${pick.away_xg ?? '?'}`);
  return (
    <div className="flex flex-col gap-1 px-2 py-2 items-start max-w-[240px]">
      {confIcon && (
        <div className="flex items-center gap-1 text-[11px] text-[#aaa]">
          <span>{confIcon}</span>
          <span>{pick.confidence}</span>
          {pick.ht_score && (
            <span className="text-[10px] text-[#666]">· HT {pick.ht_score}{pick.ft_score ? `→${pick.ft_score}` : ''}</span>
          )}
        </div>
      )}
      {hasSide && (
        <div className="flex flex-col gap-0.5 w-full">
          <span className="w-fit rounded px-1.5 py-0.5 text-[11px] bg-[#f59e0b]/15 border border-[#f59e0b]/40 text-[#fbbf24] whitespace-nowrap">
            {pick.side_pick}
          </span>
          {hc && <span className="text-[10px] text-[#888] leading-tight line-clamp-2">{hc}</span>}
        </div>
      )}
      {hasOu && (
        <div className="flex flex-col gap-0.5 w-full">
          <span className="w-fit rounded px-1.5 py-0.5 text-[11px] bg-[#17a2b8]/15 border border-[#17a2b8]/40 text-[#5fd0e0] whitespace-nowrap">
            {pick.ou_pick}
          </span>
          {ou && <span className="text-[10px] text-[#888] leading-tight line-clamp-2">{ou}</span>}
        </div>
      )}
      {statParts.length > 0 && (
        <span className="text-[10px] text-[#7a7a7a] leading-tight">📊 {statParts.join(' · ')}</span>
      )}
    </div>
  );
}

function LeagueSection({
  title,
  matches,
  hasStatsSet,
  h2hMap,
  prevMap,
  scoredIds,
  nowMs,
  loadTs,
  activeToken,
  globalReloadKey,
  h1Finals,
  autoStream,
  onAnalysis,
  onHcWatch,
  activeMatchId,
}: {
  title: string;
  matches: GsLiveMatch[];
  hasStatsSet: Set<number>;
  h2hMap: Map<string, PairResult>;
  prevMap: Map<number, GsLiveMatch>;
  scoredIds: Set<number>;
  nowMs: number;
  loadTs: number;
  activeToken: string;
  globalReloadKey: number;
  h1Finals: Map<number, { home: number; away: number }>;
  autoStream: boolean;
  onAnalysis: (m: GsLiveMatch) => void;
  onHcWatch: (m: GsLiveMatch) => void;
  activeMatchId?: number | null;
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
            // Accent line (1 line duy nhất, ưu tiên VÀNG > XANH):
            //   đã có chỉ số H1 (gs_ht_stats) → VÀNG; else đang Hiệp 2 → XANH; else không có.
            const hasStats = hasStatsSet.has(m.eventId);
            const accentColor = hasStats ? ACCENT_YELLOW : m.isH2 ? ACCENT_GREEN : null;
            return (
              <div
                key={m.eventId}
                data-event-id={m.eventId}
                className={`relative rounded-lg border overflow-hidden transition-all ${
                  activeMatchId === m.eventId
                    ? 'border-[#17a2b8] bg-[#17a2b8]/10 shadow-[0_0_0_1px_#17a2b8]'
                    : scored ? 'border-[#2a2a2a] !bg-[#16a34a]/10' : isHT ? 'border-amber-500/50 bg-amber-900/25' : 'border-[#2a2a2a] bg-[#141414]'
                }`}
                style={accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : undefined}
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
                    onClick={() => onAnalysis(m)}
                    className="flex-shrink-0 rounded px-1.5 py-1 text-[11px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#60a5fa] hover:border-[#444] transition-colors"
                    title="Kèo trận"
                  >
                    📊
                  </button>
                  {/* tạm ẩn "Kèo giá" — bật lại: đổi false → true */}
                  {false && (
                  <button
                    type="button"
                    onClick={() => onHcWatch(m)}
                    className="flex-shrink-0 rounded px-1.5 py-1 text-[11px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#fbbf24] hover:border-[#444] transition-colors"
                    title="Kèo giá −0.3/−0.5"
                  >
                    📊 Kèo giá
                  </button>
                  )}
                </div>

                {/* Đối Đầu — 2 dòng (H1 split trên, H2 split dưới) ngay dưới nút Kèo trận, luôn hiện trên mobile */}
                <div className="px-3 py-2 border-b border-[#222]">
                  <H2HLines splits={h2hMap.get(`${m.homeTeam}|${m.awayTeam}`)} />
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
                // Accent line (1 line duy nhất, ưu tiên VÀNG > XANH):
                //   đã có chỉ số H1 (gs_ht_stats) → VÀNG; else đang Hiệp 2 → XANH; else không có.
                const hasStats = hasStatsSet.has(m.eventId);
                const accentColor = hasStats ? ACCENT_YELLOW : m.isH2 ? ACCENT_GREEN : null;
                return (
                  <tr
                    key={m.eventId}
                    data-event-id={m.eventId}
                    className={`odd:bg-[#141414] even:bg-[#181818] transition-colors ${
                      activeMatchId === m.eventId
                        ? '!bg-[#17a2b8]/10 outline outline-1 outline-[#17a2b8]/40'
                        : scored ? '!bg-[#16a34a]/10' : isHT ? '!bg-amber-900/25' : ''
                    }`}
                    style={{
                      height: DESKTOP_DISPLAY_H,
                      ...(accentColor ? { boxShadow: `inset 4px 0 0 0 ${accentColor}` } : {}),
                    }}
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
                        onClick={() => onAnalysis(m)}
                        className="mt-1 rounded px-2 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#60a5fa] hover:border-[#444] transition-colors"
                        title="Kèo trận"
                      >
                        📊 Kèo trận
                      </button>
                      {/* Đối Đầu — 2 dòng (H1 split trên, H2 split dưới) ngay dưới nút Kèo trận */}
                      <H2HLines splits={h2hMap.get(`${m.homeTeam}|${m.awayTeam}`)} className="mt-1.5" />
                      {/* tạm ẩn "Kèo giá" — bật lại: đổi false → true */}
                      {false && (
                      <button
                        type="button"
                        onClick={() => onHcWatch(m)}
                        className="mt-1 ml-1 rounded px-2 py-0.5 text-[10px] border border-[#2a2a2a] bg-[#1a1a1a] text-[#888] hover:text-[#fbbf24] hover:border-[#444] transition-colors"
                        title="Kèo giá −0.3/−0.5"
                      >
                        📊 Kèo giá
                      </button>
                      )}
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
  const [agg, setAgg] = useState<TeamAnalysisAgg | null>(null);
  // Mở drawer: đã sang H2 (qua HT → thường có thông số H1) → vào tab Kèo; chưa thì Đối Kháng.
  const [activeTab, setActiveTab] = useState<'stats' | 'suggest' | 'confront' | 'matchup' | 'frames' | 'keo' | 'history'>(live.isH2 ? 'keo' : 'confront');
  const userPickedTabRef = useRef(false);
  type HtFrame = { frame_index: number; frame_url: string; video_url: string };
  const [htFrames, setHtFrames] = useState<HtFrame[] | null>(null);
  const [htFramesLoading, setHtFramesLoading] = useState(false);
  const htFramesFetchedRef = useRef(false);
  const [bets, setBets] = useState<GsBetsResponse | null>(null);
  const [betsLoading, setBetsLoading] = useState(false);
  const betsFetchedRef = useRef(false);
  // History tab: 2 selectable teams, each showing their last 10 matches
  const [histLeftTeam, setHistLeftTeam] = useState(live.homeTeam);
  const [histRightTeam, setHistRightTeam] = useState(live.awayTeam);
  const [histData, setHistData] = useState<Record<string, GsTeamHistoryRow[] | null>>({});
  const [histLoading, setHistLoading] = useState<Record<string, boolean>>({});
  const histCacheRef = useRef<Record<string, GsTeamHistoryRow[]>>({});
  const [lightboxFrame, setLightboxFrame] = useState<HtFrame | null>(null);
              const touchStartX = useRef<number | null>(null);
              const lightboxPrev = useCallback(() => {
                if (!htFrames || !lightboxFrame) return;
                const idx = lightboxFrame.frame_index;
                if (idx > 0) setLightboxFrame(htFrames[idx - 1]);
              }, [htFrames, lightboxFrame]);
              const lightboxNext = useCallback(() => {
                if (!htFrames || !lightboxFrame) return;
                const idx = lightboxFrame.frame_index;
                if (idx < htFrames.length - 1) setLightboxFrame(htFrames[idx + 1]);
              }, [htFrames, lightboxFrame]);

              useEffect(() => {
                if (!lightboxFrame) return;
                const handler = (e: KeyboardEvent) => {
                  if (e.key === 'ArrowLeft') lightboxPrev();
                  if (e.key === 'ArrowRight') lightboxNext();
                  if (e.key === 'Escape') setLightboxFrame(null);
                };
                window.addEventListener('keydown', handler);
                return () => window.removeEventListener('keydown', handler);
              }, [lightboxFrame, lightboxPrev, lightboxNext]);

  const [claudePrediction, setClaudePrediction] = useState('');
  const [predicting, setPredicting] = useState(false);
  const predAbortRef = useRef<AbortController | null>(null);
  const [goalFlash, setGoalFlash] = useState(false);
  const [activeDot, setActiveDot] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const prevScoreRef = useRef(`${live.h1Home}-${live.h1Away}`);
  const [prevPredCount, setPrevPredCount] = useState(0);
  type PrevPred = { score_home: number; score_away: number; half: string | null; minute: number | null; prediction_text: string };
  const [predHistory, setPredHistory] = useState<PrevPred[]>([]);
  const [selectedHistPred, setSelectedHistPred] = useState<PrevPred | null>(null);
  const [histDropdownOpen, setHistDropdownOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMatches(null);
    setAgg(null);
    const url = `/api/gs-team-analysis?home=${encodeURIComponent(live.homeTeam)}&away=${encodeURIComponent(live.awayTeam)}`;
    fetch(url)
      .then(r => r.json())
      .then((json: { ok: boolean; matches?: Match[]; aggregates?: TeamAnalysisAgg }) => {
        if (!alive) return;
        setMatches(json.matches ?? []);
        setAgg(json.aggregates ?? null);
      })
      .catch(() => { if (alive) { setMatches([]); setAgg(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [live.homeTeam, live.awayTeam]);

  // live.homeTeam / live.awayTeam are already canonical English (from gs-live normalizeTeam)
  // gs-team-analysis now returns names from gs_teams via JOIN — direct comparison works.
  // Form / H2H / day / hold aggregates are computed SERVER-SIDE (over the full
  // match set) and delivered in `agg`; the raw `matches` list below is only the
  // bounded slice the UI renders in FormList / H2HList.

  // Raw lists for rendering (bounded server-side; slice for display safety).
  const homeMatches = matches
    ? matches.filter(m => m.homeTeam === live.homeTeam || m.awayTeam === live.homeTeam).slice(0, 100)
    : [];
  const awayMatches = matches
    ? matches.filter(m => m.homeTeam === live.awayTeam || m.awayTeam === live.awayTeam).slice(0, 100)
    : [];
  const h2hMatches = matches
    ? matches.filter(m =>
        (m.homeTeam === live.homeTeam && m.awayTeam === live.awayTeam) ||
        (m.homeTeam === live.awayTeam && m.awayTeam === live.homeTeam)
      ).slice(0, 100)
    : [];

  // History tab: team-options list — union of teams seen in fetched data + the 2 match teams.
  const histTeamOptions = (() => {
    const set = new Set<string>([live.homeTeam, live.awayTeam]);
    for (const m of matches ?? []) { set.add(m.homeTeam); set.add(m.awayTeam); }
    return Array.from(set).sort((a, b) => a.localeCompare(b)).map(t => ({ value: t, label: t }));
  })();

  // Day stats (server-computed over the full set)
  const today = todayDayOfWeek();
  const todayLabel = DAY_LABELS_FULL[today];
  const homeDayStats = agg?.home.dayStats ?? [];
  const awayDayStats = agg?.away.dayStats ?? [];

  // Form / hold / H2H aggregates — server-computed
  const homeW = agg?.home.W ?? 0;
  const homeD = agg?.home.D ?? 0;
  const homeL = agg?.home.L ?? 0;
  const awayW = agg?.away.W ?? 0;
  const awayD = agg?.away.D ?? 0;
  const awayL = agg?.away.L ?? 0;

  const homeAvgConceded = agg?.home.avgConceded ?? 0;
  const awayAvgConceded = agg?.away.avgConceded ?? 0;
  const homeHoldW = agg?.home.holdW ?? 0;
  const homeHoldTotal = agg?.home.holdTotal ?? 0;
  const awayHoldW = agg?.away.holdW ?? 0;
  const awayHoldTotal = agg?.away.holdTotal ?? 0;
  const h2hHomeW = agg?.h2h.homeW ?? 0;
  const h2hDraws = agg?.h2h.draws ?? 0;
  const h2hAwayW = agg?.h2h.awayW ?? 0;
  const h2hTotal = agg?.h2h.n ?? 0;

  function renderClaudeLine(line: string, idx: number) {
    const trimmed = line.trim();
    if (!trimmed) return <div key={idx} className="h-2" />;
    if (trimmed === '---' || trimmed === '***') return <hr key={idx} className="border-[#2a1a4a] my-2" />;

    // Inline parser: **bold**, team names, %, CÓ/KHÔNG, ~X%
    const inlineTokens = (text: string) => {
      const nodes: React.ReactNode[] = [];
      let rem = text;
      let ki = 0;
      const teamA = live.homeTeam;
      const teamB = live.awayTeam;
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
    setPredicting(true);

    // Fetch previous Claude predictions for this live match
    let previousPredictions: PrevPred[] = [];
    try {
      if (live.eventId) {
        const histRes = await fetch(`/api/gs-claude-history?eventId=${live.eventId}`);
        if (histRes.ok) {
          const histJson = await histRes.json() as { ok: boolean; predictions?: PrevPred[] };
          previousPredictions = histJson.predictions ?? [];
          setPrevPredCount(previousPredictions.length);
          setPredHistory(previousPredictions);
          setSelectedHistPred(null); // reset to live view on refresh
        }
      }
    } catch { /* non-fatal */ }

    const homeAvgGoals = agg?.home.avgGoals ?? 0;
    const awayAvgGoals = agg?.away.avgGoals ?? 0;

    const body = JSON.stringify({
      homeTeam: live.homeTeam,
      awayTeam: live.awayTeam,
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
      h2hHomeW, h2hDraws, h2hAwayW, h2hTotal,
      previousPredictions: previousPredictions.length > 0 ? previousPredictions : undefined,
    });
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal };

    try {
      // Claude — stream with typing animation
      const claudeRes = await fetch('/api/gs-predict', opts);
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
        const saveKey = `event=${live.eventId} score=${live.h1Home}-${live.h1Away}`;
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
        }).then(async (res) => {
          const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; action?: string };
          if (!res.ok || json.ok === false) {
            console.error('[gs-history] save failed', saveKey, res.status, json.error);
            return;
          }
          console.log('[gs-history] saved', saveKey, json.action ?? '');
          const newEntry: PrevPred = {
            score_home: live.h1Home,
            score_away: live.h1Away,
            half: live.isH2 ? 'H2' : 'H1',
            minute: live.minuteElapsed ?? 0,
            prediction_text: fullClaudeText,
          };
          // Only increment count on INSERT (new score), not UPDATE (overwrite)
          if (json.action === 'insert') setPrevPredCount(c => c + 1);
          setPredHistory(prev => {
            const idx = prev.findIndex(p => p.score_home === live.h1Home && p.score_away === live.h1Away);
            if (idx >= 0) { const u = [...prev]; u[idx] = newEntry; return u; }
            return [...prev, newEntry];
          });
        }).catch((err) => { console.error('[gs-history] fetch error', saveKey, err); });
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

  // Auto-load exactly once per drawer open — when data is ready and tab is suggest.
  // useRef guards against re-firing every time user switches back to 'suggest' tab.
  const triggerRef = useRef<() => void>(triggerPrediction);
  useEffect(() => { triggerRef.current = triggerPrediction; });
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'suggest' || !matches) return;
    if (autoTriggeredRef.current) return; // already called once for this drawer session
    autoTriggeredRef.current = true;
    triggerRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, matches]);

  // Fetch HT frames once when the frames tab is opened
  useEffect(() => {
    if (activeTab !== 'frames' || htFramesFetchedRef.current || !live.eventId) return;
    htFramesFetchedRef.current = true;
    let alive = true;
    setHtFramesLoading(true);
    fetch(`/api/ht-frames?eventId=${live.eventId}`)
      .then(r => r.json())
      .then((json: { frames?: HtFrame[] }) => { if (alive) setHtFrames(json.frames ?? []); })
      .catch(() => { if (alive) setHtFrames([]); })
      .finally(() => { if (alive) setHtFramesLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, live.eventId]);

  // Fetch bets/kèo once when the keo tab is opened
  useEffect(() => {
    if (activeTab !== 'keo' || betsFetchedRef.current || !live.eventId) return;
    betsFetchedRef.current = true;
    let alive = true;
    setBetsLoading(true);
    fetch(`/api/gs-bets?eventId=${live.eventId}`)
      .then(r => r.json())
      .then((json: GsBetsResponse) => {
        if (!alive) return;
        setBets(json);
        // Nếu mở drawer auto vào tab Kèo nhưng thực tế CHƯA có thông số H1 → lùi về Đối Kháng.
        if (!userPickedTabRef.current && (json.ok === false || !json.stats)) setActiveTab('confront');
      })
      .catch(() => { if (alive) setBets({ ok: false, error: 'fetch failed' }); })
      .finally(() => { if (alive) setBetsLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, live.eventId]);

  // History tab: fetch last-10 for each selected team (fetch-once per team, refetch on change).
  useEffect(() => {
    if (activeTab !== 'history') return;
    const teams = [histLeftTeam, histRightTeam].filter((t, i, a) => t && a.indexOf(t) === i);
    let alive = true;
    for (const team of teams) {
      if (histCacheRef.current[team] || histLoading[team]) continue;
      setHistLoading(s => ({ ...s, [team]: true }));
      fetch(`/api/gs-team-history?team=${encodeURIComponent(team)}`)
        .then(r => r.json())
        .then((json: GsTeamHistoryResponse) => {
          if (!alive) return;
          const rows = json.ok ? (json.matches ?? []) : [];
          histCacheRef.current[team] = rows;
          setHistData(s => ({ ...s, [team]: rows }));
        })
        .catch(() => { if (alive) setHistData(s => ({ ...s, [team]: [] })); })
        .finally(() => { if (alive) setHistLoading(s => ({ ...s, [team]: false })); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, histLeftTeam, histRightTeam]);

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
          const ih = m.homeTeam === live.homeTeam;
          const homeScore = +m.ttHome;
          const awayScore = +m.ttAway;
          const winner = homeScore > awayScore ? m.homeTeam : awayScore > homeScore ? m.awayTeam : null;
          // H/A relative to the H2H match itself (home/away of displayed row), color relative to live match
          const h2hLabel = winner === null ? 'D' : winner === m.homeTeam ? 'H' : 'A';
          const wCls = winner === live.homeTeam ? 'text-[#4ade80]' : winner === live.awayTeam ? 'text-[#f87171]' : winner === null ? 'text-[#fbbf24]' : 'text-[#aaa]';
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
    if (h2hTotal > 0) {
      const h2hRatio = (h2hHomeW + h2hDraws * 0.5) / h2hTotal;
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
              {homeLeads ? live.homeTeam : live.awayTeam} ưu thế
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
          {h2hTotal > 0 && (
            <span className="text-[10px] text-[#555] flex-shrink-0">H2H {h2hHomeW}-{h2hDraws}-{h2hAwayW}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/60" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[201] w-[calc(100%-44px)] md:w-[680px] bg-[#111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
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
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none px-2 pt-2 border-b border-[#1a1a1a] flex-shrink-0 bg-[#0d0d0d]">
          {([
            // Tạm ẩn 'Lịch sử' (mai mốt thêm lại: bỏ comment dòng history bên dưới).
            ['stats',    '📊', 'Thống kê',  'border-[#fbbf24]'],
            ['suggest',  '💡', 'Gợi ý',     'border-[#4ade80]'],
            ['confront', '⚔️', 'Đối Kháng', 'border-[#17a2b8]'],
            ['matchup',  '🔥', 'Diễn biến', 'border-[#fb7185]'],
            // ['history',  '📜', 'Lịch sử',    'border-[#22d3ee]'],
            ['keo',      '🎯', 'Kèo',       'border-[#f59e0b]'],
            ...(live.period >= 4 ? [['frames', '📷', 'HT', 'border-[#a78bfa]']] as [string, string, string, string][] : []),
          ] as [string, string, string, string][]).map(([key, icon, label, activeBorder]) => (
            <button
              key={key}
              onClick={() => { userPickedTabRef.current = true; setActiveTab(key as typeof activeTab); }}
              className={`flex-shrink-0 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-semibold rounded-t border-b-2 transition-colors ${
                activeTab === key
                  ? `text-white ${activeBorder}`
                  : 'text-[#666] border-transparent hover:text-[#aaa]'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && <LoadingState label="Đang tải dữ liệu…" />}

          {!loading && matches !== null && activeTab === 'stats' && (
            <div className="flex flex-col gap-0">
              {/* Section: Phong độ theo ngày */}
              <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">
                  📅 Phong độ theo ngày · Hôm nay: {todayLabel}
                </div>
                <div className="flex flex-col gap-1.5 md:gap-4">
                  <DayBar stats={homeDayStats} team={live.homeTeam} />
                  <DayBar stats={awayDayStats} team={live.awayTeam} />
                </div>
              </div>

              {/* Section: 20 trận gần nhất — 2 col side by side, khung cao ~5 hàng rồi scroll trong list */}
              <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">📋 20 trận gần nhất</div>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 md:mb-1.5 text-[10px] font-semibold text-[#aaa] truncate">{live.homeTeam}</div>
                    <div className="max-h-[124px] md:max-h-[152px] overflow-y-auto pr-1">
                      <FormList recentMatches={homeMatches.slice(0, 20)} team={live.homeTeam} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 md:mb-1.5 text-[10px] font-semibold text-[#aaa] truncate">{live.awayTeam}</div>
                    <div className="max-h-[124px] md:max-h-[152px] overflow-y-auto pr-1">
                      <FormList recentMatches={awayMatches.slice(0, 20)} team={live.awayTeam} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section: 20 trận đối đầu — khung cao ~5 hàng rồi scroll trong list */}
              <div className="px-3 py-3 md:px-4 md:py-4">
                <div className="mb-2 md:mb-3 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">⚔️ 20 trận đối đầu</div>
                <div className="max-h-[124px] md:max-h-[152px] overflow-y-auto pr-1">
                  <H2HList h2h={h2hMatches.slice(0, 20)} />
                </div>
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
                {(() => {
                  const displayedPrediction = selectedHistPred ? selectedHistPred.prediction_text : claudePrediction;
                  const histNewestFirst = [...predHistory].reverse();
                  return (
                    <div className={`snap-start shrink-0 w-full rounded-xl border bg-[#0f0a1a] overflow-hidden transition-all duration-300 ${goalFlash ? 'border-[#fbbf24]/60' : 'border-[#2a1a4a]'}`}>
                      {/* Header */}
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a1a4a]">
                        <span className="text-[12px] font-extrabold text-[#a78bfa]">✨ Claude</span>
                        {predicting && !claudePrediction && <span className="text-[10px] text-[#fbbf24] animate-pulse ml-1">đang phân tích…</span>}
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

                      {/* History dropdown — inside box, below header */}
                      {predHistory.length > 0 && (
                        <div className="relative border-b border-[#2a1a4a]">
                          <button
                            onClick={() => setHistDropdownOpen(o => !o)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-[#160d2a] transition-colors"
                          >
                            <span className="text-[#a78bfa]/60">📚</span>
                            <span className={`font-semibold ${selectedHistPred ? 'text-[#fbbf24]' : 'text-[#a78bfa]/50'}`}>
                              {selectedHistPred
                                ? `${selectedHistPred.score_home}-${selectedHistPred.score_away}${selectedHistPred.half ? ` · ${selectedHistPred.half}` : ''}${selectedHistPred.minute != null ? ` ${selectedHistPred.minute}'` : ''}`
                                : `Lịch sử dự đoán (${predHistory.length})`}
                            </span>
                            <span className="ml-auto text-[10px] text-[#555]">{histDropdownOpen ? '▲' : '▼'}</span>
                          </button>

                          {histDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setHistDropdownOpen(false)} />
                              <div className="absolute left-0 right-0 top-full z-20 border border-[#3a2a5a] border-t-0 bg-[#0a0518] shadow-xl overflow-hidden rounded-b-lg">
                                {/* Live / current */}
                                <button
                                  onClick={() => { setSelectedHistPred(null); setHistDropdownOpen(false); }}
                                  className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors ${selectedHistPred === null ? 'bg-[#1a0a3a] text-[#a78bfa] font-bold' : 'text-[#888] hover:bg-[#110830]'}`}
                                >
                                  <span className="text-[8px]">🔴</span> Hiện tại (live)
                                </button>
                                {histNewestFirst.map((p, i) => {
                                  const label = `${p.score_home}-${p.score_away}${p.half ? ` · ${p.half}` : ''}${p.minute != null ? ` ${p.minute}'` : ''}`;
                                  const isSelected = selectedHistPred === p;
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => { setSelectedHistPred(p); setHistDropdownOpen(false); }}
                                      className={`w-full text-left px-3 py-2 text-[11px] border-t border-[#2a1a4a] flex items-center gap-2 transition-colors ${isSelected ? 'bg-[#1a0a3a] text-[#fbbf24] font-bold' : 'text-[#888] hover:bg-[#110830]'}`}
                                    >
                                      <span className="text-[8px] text-[#555]">◷</span> {label}
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Body */}
                      <div className="px-3 py-2.5">
                        {!displayedPrediction && !predicting && <div className="text-[13px] text-[#555]">Đang tải…</div>}
                        {displayedPrediction && (
                          <div className="space-y-0.5">
                            {displayedPrediction.split('\n').map((line, i) => renderClaudeLine(line, i))}
                            {predicting && !selectedHistPred && <span className="inline-block w-1.5 h-3.5 bg-[#a78bfa] ml-0.5 animate-pulse align-middle" />}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>
          )}

          {activeTab === 'confront' && (
            <MatchAnalysis
              embedded
              initialTeamA={live.homeTeam}
              initialTeamB={live.awayTeam}
            />
          )}

          {activeTab === 'matchup' && (
            <MatchupView teamA={live.homeTeam} teamB={live.awayTeam} />
          )}

          {activeTab === 'frames' && (
            <div className="px-3 py-3 md:px-4 md:py-4">
              {htFramesLoading && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="rounded-lg bg-[#1a1a1a] w-full aspect-video animate-pulse" />
                  ))}
                </div>
              )}

              {!htFramesLoading && htFrames !== null && htFrames.length === 0 && (
                <div className="flex items-center justify-center py-16 text-[#666] text-[13px]">Chưa có ảnh HT</div>
              )}

              {!htFramesLoading && htFrames !== null && htFrames.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                  {htFrames.map((frame) => (
                    <button
                      key={frame.frame_index}
                      onClick={() => setLightboxFrame(frame)}
                      className="group flex flex-col gap-1 text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={frame.frame_url}
                        alt={`Shot ${frame.frame_index + 1}`}
                        className="rounded-lg object-cover w-full aspect-video group-hover:opacity-80 transition-opacity cursor-zoom-in"
                      />
                      <span className="text-[10px] text-[#666] text-center w-full">Shot {frame.frame_index + 1}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Lightbox */}
              {lightboxFrame && (
                <div
                  className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
                  onClick={() => setLightboxFrame(null)}
                >
                  <div
                    className="relative w-full md:max-w-3xl md:rounded-xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                    onTouchEnd={(e) => {
                      if (touchStartX.current === null) return;
                      const dx = e.changedTouches[0].clientX - touchStartX.current;
                      touchStartX.current = null;
                      if (dx < -50) lightboxNext();
                      else if (dx > 50) lightboxPrev();
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={lightboxFrame.frame_url}
                      alt={`Shot ${lightboxFrame.frame_index + 1}`}
                      className="w-full object-contain max-h-screen md:max-h-[80vh]"
                    />
                    {/* Prev button — desktop only */}
                    {lightboxFrame.frame_index > 0 && (
                      <button
                        onClick={lightboxPrev}
                        className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 items-center justify-center w-9 h-9 bg-black/60 rounded-full text-white hover:bg-black/80 text-lg"
                      >
                        ‹
                      </button>
                    )}
                    {/* Next button — desktop only */}
                    {htFrames && lightboxFrame.frame_index < htFrames.length - 1 && (
                      <button
                        onClick={lightboxNext}
                        className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center w-9 h-9 bg-black/60 rounded-full text-white hover:bg-black/80 text-lg"
                      >
                        ›
                      </button>
                    )}
                    <div className="absolute top-2 right-2">
                      <button
                        onClick={() => setLightboxFrame(null)}
                        className="px-2 py-1 bg-black/60 rounded text-[11px] text-white hover:bg-black/80"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded text-[12px] text-white">
                      Shot {lightboxFrame.frame_index + 1} / {htFrames?.length ?? '?'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'keo' && (
            <KeoPanel loading={betsLoading} bets={bets} homeName={live.homeTeam} awayName={live.awayTeam} />
          )}

          {activeTab === 'history' && (
            <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-0">
              <div className="border-b border-[#1a1a1a] md:border-b-0 md:border-r">
                <TeamHistoryColumn
                  teamOptions={histTeamOptions}
                  value={histLeftTeam}
                  onChange={setHistLeftTeam}
                  loading={!!histLoading[histLeftTeam]}
                  rows={histData[histLeftTeam] ?? null}
                />
              </div>
              <div>
                <TeamHistoryColumn
                  teamOptions={histTeamOptions}
                  value={histRightTeam}
                  onChange={setHistRightTeam}
                  loading={!!histLoading[histRightTeam]}
                  rows={histData[histRightTeam] ?? null}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Lịch sử đội tab ─────────────────────────────────────────────────────────

function TeamHistoryColumn({
  teamOptions, value, onChange, loading, rows,
}: {
  teamOptions: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
  rows: GsTeamHistoryRow[] | null;
}) {
  // Ensure the current value is always a selectable option (in case it isn't in the fetched set yet)
  const options = teamOptions.some(o => o.value === value)
    ? teamOptions
    : [{ value, label: value }, ...teamOptions];

  return (
    <div className="px-3 py-3 md:px-4 md:py-4">
      <div className="mb-2.5">
        <SearchDropdown
          options={options}
          value={value}
          onChange={onChange}
          placeholder="-- Chọn đội --"
        />
      </div>

      {loading ? (
        <LoadingState label="Đang tải lịch sử…" />
      ) : rows === null ? (
        <LoadingState label="Đang tải lịch sử…" />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-[#555]">Không có dữ liệu</div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => {
            const [my, op] = r.ft;
            const result = my > op ? 'W' : my === op ? 'D' : 'L';
            const badge =
              result === 'W' ? { cls: 'bg-[#14532d] text-[#4ade80]', txt: 'Thắng' }
              : result === 'L' ? { cls: 'bg-[#450a0a] text-[#f87171]', txt: 'Thua' }
              : { cls: 'bg-[#333] text-[#aaa]', txt: 'Hòa' };
            const h2: [number, number] = [r.ft[0] - r.h1[0], r.ft[1] - r.h1[1]];
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-[#1c1c1c] bg-[#141414] px-2 py-1.5"
              >
                <span
                  className={`flex-shrink-0 rounded px-[6px] py-0.5 text-[10px] font-bold ${badge.cls}`}
                >
                  {badge.txt}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[#ddd]">
                  {r.isHome ? '' : '@ '}{r.opponent}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1.5 tabular-nums text-[11px]">
                  <span className="text-[#777]">H1 <span className="font-semibold text-[#bbb]">{r.h1[0]}-{r.h1[1]}</span></span>
                  <span className="text-[#777]">H2 <span className="font-semibold text-[#bbb]">{h2[0]}-{h2[1]}</span></span>
                  <span className="text-[#666]">FT <span className="font-bold text-white">{r.ft[0]}-{r.ft[1]}</span></span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Kèo tab ─────────────────────────────────────────────────────────────────

function HitBadge({ hit, label }: { hit: boolean | null; label: string }) {
  const cls = hit === true
    ? 'bg-[#16a34a]/15 border-[#16a34a]/40 text-[#4ade80]'
    : hit === false
      ? 'bg-[#dc2626]/15 border-[#dc2626]/40 text-[#f87171]'
      : 'bg-[#555]/15 border-[#555]/40 text-[#aaa]';
  const text = hit === true ? 'ĂN' : hit === false ? 'THUA' : 'HÒA/PUSH';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls}`}>
      <span className="text-[#666]">{label}</span> {text}
    </span>
  );
}

// Parse predict.js verdict: pull the reason text after "[HC] ... ::" and "[OU] ... ::"
function parseVerdictReasons(verdict: string | null): { hc: string | null; ou: string | null } {
  if (!verdict) return { hc: null, ou: null };
  const grab = (tag: string): string | null => {
    // e.g. "[HC] BỎ :: xG-trap: Laos dominant but LOSING → BỎ"
    const re = new RegExp(`\\[${tag}\\][^:\\n]*::\\s*([^\\n]+)`);
    const m = verdict.match(re);
    return m ? m[1].trim() : null;
  };
  return { hc: grab('HC'), ou: grab('OU') };
}

function KeoPanel({ loading, bets, homeName, awayName }: { loading: boolean; bets: GsBetsResponse | null; homeName: string; awayName: string }) {
  if (loading || bets === null) {
    return <LoadingState label="Đang tải kèo…" />;
  }
  if (bets.ok === false) {
    return <div className="flex items-center justify-center py-16 text-[#666] text-[13px]">Không tải được kèo</div>;
  }

  const pick = bets.pick ?? null;
  const stats = bets.stats ?? null;

  return (
    <div className="flex flex-col gap-0">
      {/* 1. Kèo card */}
      <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
        <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">🎯 Kèo đã ra</div>
        {!pick ? (
          <div className="text-[12px] text-[#555] py-1">Chưa ra kèo cho trận này</div>
        ) : (
          <div className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2.5">
            <div className="flex items-center flex-wrap gap-2 mb-2">
              {pick.side_pick && (
                <span className="px-2 py-1 rounded-lg bg-[#f59e0b]/15 border border-[#f59e0b]/40 text-[#fbbf24] text-[12px] font-extrabold">
                  {pick.side_pick}
                </span>
              )}
              {pick.ou_pick && (
                <span className="px-2 py-1 rounded-lg bg-[#17a2b8]/15 border border-[#17a2b8]/40 text-[#5fd0e0] text-[12px] font-extrabold">
                  {pick.ou_pick}
                </span>
              )}
              {pick.confidence && (
                <span className="ml-auto px-2 py-0.5 rounded bg-[#a78bfa]/15 border border-[#a78bfa]/40 text-[#a78bfa] text-[11px] font-bold">
                  {pick.confidence}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#aaa] mb-1.5">
              {pick.hc_line != null && (
                <span>HC <span className="text-[#ccc] font-semibold">{pick.hc_line}</span>
                  {pick.hc_home_odds != null && <span className="text-[#666]"> · nhà {pick.hc_home_odds}</span>}
                  {pick.hc_away_odds != null && <span className="text-[#666]"> · khách {pick.hc_away_odds}</span>}
                </span>
              )}
              {pick.ou_line != null && (
                <span>OU <span className="text-[#ccc] font-semibold">{pick.ou_line}</span>
                  {pick.ou_over_odds != null && <span className="text-[#666]"> · tài {pick.ou_over_odds}</span>}
                  {pick.ou_under_odds != null && <span className="text-[#666]"> · xỉu {pick.ou_under_odds}</span>}
                </span>
              )}
              {(pick.ht_score || pick.ft_score) && (
                <span className="tabular-nums text-[#ccc]">
                  {pick.ht_score ?? '?'}{pick.ft_score ? ` → ${pick.ft_score}` : ''}
                </span>
              )}
            </div>

            {pick.ft_score && (
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                {pick.side_pick && <HitBadge hit={pick.side_hit} label="HC" />}
                {pick.ou_pick && <HitBadge hit={pick.ou_hit} label="OU" />}
              </div>
            )}

            {pick.verdict && (() => {
              const { hc, ou } = parseVerdictReasons(pick.verdict);
              const hasParsed = hc || ou;
              return (
                <div className="flex flex-col gap-1 mt-1">
                  {(pick.side_pick || hc) && (
                    <div className="text-[12px] leading-snug">
                      <span className="text-[#666] font-semibold">Kèo chấp: </span>
                      {pick.side_pick && <span className="text-[#fbbf24] font-bold">{pick.side_pick}</span>}
                      {hc && <span className="text-[#ddd]">{pick.side_pick ? ' — ' : ''}{hc}</span>}
                    </div>
                  )}
                  {(pick.ou_pick || ou) && (
                    <div className="text-[12px] leading-snug">
                      <span className="text-[#666] font-semibold">Tài/Xỉu: </span>
                      {pick.ou_pick && <span className="text-[#5fd0e0] font-bold">{pick.ou_pick}</span>}
                      {ou && <span className="text-[#ddd]">{pick.ou_pick ? ' — ' : ''}{ou}</span>}
                    </div>
                  )}
                  {!hasParsed && (
                    <div className="text-[12px] text-[#ddd] leading-snug">{pick.verdict}</div>
                  )}
                </div>
              );
            })()}

            {pick.review_note && (
              <div className="mt-2 rounded-md border-l-2 border-[#a78bfa]/50 bg-[#a78bfa]/[.06] px-2.5 py-1.5 text-[12px] leading-snug">
                <span className="font-bold text-[#a78bfa]">📝 Đúc kết: </span>
                <span className="text-[#ddd]">{pick.review_note}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Chỉ số H1 */}
      <div className="px-3 py-3 md:px-4 md:py-4 border-b border-[#1a1a1a]">
        <div className="mb-2 text-[10px] md:text-[11px] font-bold uppercase tracking-wide text-[#555]">📊 Chỉ số H1</div>
        <H1StatsPanel stats={stats} homeName={homeName} awayName={awayName} />
      </div>
    </div>
  );
}

