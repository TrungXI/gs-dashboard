'use client';

import { useEffect, useRef, useState } from 'react';
import type { PairResult } from '../app/api/gs-h2h-splits/route';
import { type GsLiveMatch, type Toast, ToastContainer } from './GSLive';
import MatchDetailDrawer from './MatchDetailDrawer';

const GS_STREAM_TOKEN = process.env.NEXT_PUBLIC_GS_TOKEN ?? '';

const LEAGUE_16P = 2140;
const LEAGUE_20P = 2125;

// Prefetch cả 3 mức đối đầu để bấm filter đổi số tức thì (không chờ API).
const H2H_LIMITS = [20, 50, 100] as const;
const EMPTY_H2H = new Map<string, PairResult>();

function phaseParts(m: GsLiveMatch, nowMs: number): { big: string; small: string | null; color: string } {
  if (!m.isLive) {
    const waiting = nowMs < new Date(m.startTime).getTime();
    return { big: waiting ? 'Chờ' : 'KT', small: null, color: '#888' };
  }
  if (m.period === 4) return { big: 'HT', small: 'Nghỉ', color: '#fbbf24' };
  const min = m.minuteElapsed ?? 0;
  if (m.isH2) return { big: 'H2', small: `${min}'`, color: '#4ade80' };
  return { big: 'H1', small: `${min}'`, color: '#fbbf24' };
}

export default function RankingLive() {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // Cache lồng: limit (20/50/100) → (cặp đấu → kết quả). Cả 3 mức prefetch sẵn.
  const [h2hByLimit, setH2hByLimit] = useState<Map<number, Map<string, PairResult>>>(new Map());
  const [selected, setSelected] = useState<GsLiveMatch | null>(null);
  // Số trận đối đầu gần nhất để tính % (20/50/100). Mặc định 20, nhớ localStorage.
  const [h2hLimit, setH2hLimitState] = useState<number>(20);
  useEffect(() => {
    const v = Number(localStorage.getItem('gs_h2h_limit'));
    if (v === 20 || v === 50 || v === 100) setH2hLimitState(v);
  }, []);
  function setH2hLimit(n: number) {
    setH2hLimitState(n);
    localStorage.setItem('gs_h2h_limit', String(n));
  }

  // H1 final scores tracked across H1→H2 transition
  const h1FinalRef = useRef<Map<number, { home: number; away: number }>>(new Map());
  const [h1Finals, setH1Finals] = useState<Map<number, { home: number; away: number }>>(new Map());
  const prevRef = useRef<Map<number, GsLiveMatch>>(new Map());

  // ── Toasts + OS notifications (mirror of GS Live) ──────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [scoredIds, setScoredIds] = useState<Set<number>>(new Set());
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);
  const osNotiGoalRef = useRef(false);
  const osNotiHTRef = useRef(false);

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

  function pushToast(kind: Toast['kind'], message: string) {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'goal' ? 10000 : 20000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Tick every 30s to keep phaseLabel fresh
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // 2s poll for live matches
  useEffect(() => {
    let alive = true;

    async function poll() {
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
          const next = json.matches ?? [];
          // Goal detection vs previous poll → toast + OS noti + green flash
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
          // Track H1→H2 transition to remember H1 final + notify halftime
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

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // H2H splits — keyed by stable pair set, refresh every 5 min.
  // Prefetch cả 20/50/100 song song → đổi filter là đọc cache, không call API lại.
  const pairsKey = Array.from(new Set(matches.map((m) => `${m.homeTeam}|${m.awayTeam}`))).sort().join(',');
  useEffect(() => {
    if (!pairsKey) { setH2hByLimit(new Map()); return; }
    let alive = true;
    const pairsParam = pairsKey
      .split(',')
      .map((pair) => pair.split('|').map(encodeURIComponent).join('|'))
      .join(',');
    async function loadOne(limit: number) {
      try {
        const res = await fetch(`/api/gs-h2h-splits?pairs=${pairsParam}&limit=${limit}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; pairs?: PairResult[] };
        if (!alive || !json.ok || !json.pairs) return;
        const m = new Map(json.pairs.map((p) => [`${p.teamA}|${p.teamB}`, p]));
        setH2hByLimit((prev) => new Map(prev).set(limit, m));
      } catch {
        /* giữ cache cũ khi lỗi mạng tạm thời */
      }
    }
    function loadAll() { for (const l of H2H_LIMITS) loadOne(l); }
    loadAll();
    const id = setInterval(loadAll, 300_000);
    return () => { alive = false; clearInterval(id); };
  }, [pairsKey]);

  // Map hiển thị = mức đang chọn (đã prefetch). Đổi filter chỉ đổi con trỏ này.
  const h2hMap = h2hByLimit.get(h2hLimit) ?? EMPTY_H2H;

  const liveMatches = matches.filter(
    (m) => m.leagueId === LEAGUE_16P || m.leagueId === LEAGUE_20P,
  );

  const sorted = [...liveMatches].sort((a, b) => a.eventId - b.eventId);

  const group16 = sorted.filter((m) => m.leagueId === LEAGUE_16P);
  const group20 = sorted.filter((m) => m.leagueId === LEAGUE_20P);

  const leagueName16 = group16[0]?.leagueName ?? '16 Phút';
  const leagueName20 = group20[0]?.leagueName ?? '20 Phút';

  function MatchBox({ m }: { m: GsLiveMatch }) {
    const isHT = m.period === 4;
    const scored = scoredIds.has(m.eventId);
    const h1Final = h1Finals.get(m.eventId);
    const phase = phaseParts(m, nowMs);
    // Hiệp đang diễn ra → tô nền cam box tương ứng (phân biệt đang H1 hay H2).
    const activeHalf = phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'h2' : null;
    // H2H theo hiệp: H1 (đang đá H1) hiện cả H1+H2; đã sang H2/nghỉ chỉ hiện H2.
    const sp = h2hMap.get(`${m.homeTeam}|${m.awayTeam}`);
    const meetings = sp?.meetings ?? 0;
    const showBoth = !m.isH2 && m.period !== 4;
    const halves = sp && meetings > 0
      ? (showBoth
          ? [{ key: 'h2', label: 'H2', s: sp.h2 }, { key: 'h1', label: 'H1', s: sp.h1 }]
          : [{ key: 'h2', label: 'H2', s: sp.h2 }])
      : [];
    return (
      <div
        data-event-id={m.eventId}
        role="button"
        onClick={() => setSelected(m)}
        className={`rounded-lg border p-2.5 w-full md:w-[360px] flex-shrink-0 transition-all cursor-pointer hover:border-[#444] flex items-stretch ${
          scored
            ? 'border-[#22c55e]/60 !bg-[#16a34a]/15'
            : isHT
            ? 'border-amber-500/50 bg-amber-900/10'
            : 'border-[#2a2a2a] bg-[#141414]'
        }`}
      >
        {/* Left: tên đội + tỉ số ở trái, khối H1/H2 tách riêng canh giữa (mobile & desktop giống nhau) */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="min-w-0 shrink-0 basis-[42%]">
            <div className="text-[13px] font-semibold text-white truncate leading-tight">{m.homeTeam}</div>
            <div className="text-[10px] text-[#666] my-0.5 leading-tight">Hoà</div>
            <div className="text-[12px] text-[#888] truncate leading-tight">{m.awayTeam}</div>
            <div className={`mt-1.5 text-[18px] font-bold leading-none ${scored ? 'text-[#22c55e]' : 'text-[#fbbf24]'}`}>
              {m.h1Home} - {m.h1Away}
            </div>
            {m.isH2 && h1Final && (
              <div className="text-[10px] text-[#aaa] mt-0.5">H1: {h1Final.home}-{h1Final.away}</div>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center gap-2.5">
            {halves.length === 0 ? (
              <span className="text-[11px] text-[#555]">ĐĐ —</span>
            ) : (
              halves.map((h) => (
                <div
                  key={h.key}
                  className={`flex flex-col items-center rounded-md border px-3 py-1 min-w-[56px] ${
                    h.key === activeHalf
                      ? 'border-[#f59e0b]/60 bg-[#f59e0b]/20'
                      : 'border-[#2a2a2a] bg-[#1c1c1c]'
                  }`}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">
                    {h.label} <span className="normal-case tracking-normal text-[#555]">n={meetings}</span>
                  </span>
                  <span className="text-[15px] font-bold tabular-nums text-[#4ade80] leading-tight">{h.s.aWinPct}%</span>
                  <span className="text-[12px] font-bold tabular-nums text-[#8a8a8a] leading-tight my-0.5">{h.s.drawPct}%</span>
                  <span className="text-[15px] font-bold tabular-nums text-[#fb7185] leading-tight">{h.s.bWinPct}%</span>
                </div>
              ))
            )}
          </div>
        </div>
        {/* Right: prominent phase panel */}
        <div className="w-[84px] md:w-[96px] flex flex-col items-center justify-center text-center flex-shrink-0 pl-3 border-l border-[#222]">
          <div className="text-[30px] md:text-[34px] font-extrabold leading-none" style={{ color: phase.color }}>
            {phase.big}
          </div>
          {phase.small && (
            <div className="text-[13px] font-semibold text-[#aaa] mt-1">{phase.small}</div>
          )}
        </div>
      </div>
    );
  }

  function LeagueGroup({ title, items }: { title: string; items: GsLiveMatch[] }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] md:text-[13px] font-semibold text-[#fbbf24]">{title}</span>
          <span className="text-[11px] text-[#555]">{items.length} trận</span>
        </div>
        <div className="flex flex-col md:flex-row md:flex-wrap gap-2">
          {items.map((m) => <MatchBox key={m.eventId} m={m} />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {/* Header */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">🏆 Xếp hạng — Live</h1>
        <span className="text-[13px] text-[#666]">{liveMatches.length} trận live</span>
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
        {/* Filter số trận đối đầu để tính % */}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] text-[#666]">ĐĐ:</span>
          {[20, 50, 100].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setH2hLimit(n)}
              className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${h2hLimit === n ? 'border-[#17a2b8]/50 text-[#22d3ee] bg-[#17a2b8]/15' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
              title={`Tính % trên ${n} trận đối đầu gần nhất`}
            >
              {n} trận
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">
          {error}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="mb-3 text-4xl">⏳</div>
          <div className="text-[14px] text-[#888]">Chưa có trận live. Đang chờ dữ liệu…</div>
        </div>
      ) : (
        <>
          <LeagueGroup title={leagueName20} items={group20} />
          <LeagueGroup title={leagueName16} items={group16} />
        </>
      )}

      {selected && (
        <MatchDetailDrawer
          eventId={selected.eventId}
          home={selected.homeTeam}
          away={selected.awayTeam}
          initialTab="h2h"
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
