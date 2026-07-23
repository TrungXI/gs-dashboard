'use client';

import { useEffect, useRef, useState } from 'react';
import type { PairResult } from '../app/api/gs-h2h-splits/route';
import type { H2HPair, H2HPairStat } from '../lib/gsMatchesDb';
import { type GsLiveMatch, type Toast, ToastContainer } from './GSLive';
import { pct } from './H2HMatrix';
import MatchDetailDrawer from './MatchDetailDrawer';
import { Spinner } from './Spinner';

// Kết quả fetch /api/gs-h2h-pair cho 1 trận. 'loading' | 'error' | dữ liệu H2H.
type PairState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ft: H2HPairStat | null; h1: H2HPairStat | null };

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
  // Kiểu hiển thị list: 'live' = Tài/Xỉu LIVE theo hiệp (H2/H1), 'h2h' = Tài/Xỉu
  // LỊCH SỬ đối đầu cặp đó (FT/H1, từ /api/gs-h2h-pair). Mặc định 'live', nhớ localStorage.
  const [rankMode, setRankMode] = useState<'live' | 'h2h'>('live');
  useEffect(() => {
    if (localStorage.getItem('gs_rank_view_mode') === 'h2h') setRankMode('h2h');
  }, []);
  function toggleRankMode() {
    setRankMode((prev) => {
      const next = prev === 'live' ? 'h2h' : 'live';
      localStorage.setItem('gs_rank_view_mode', next);
      return next;
    });
  }
  // Cache H2H Tài/Xỉu lịch sử theo eventId (chỉ fetch cái chưa có; đổi mode không refetch).
  const [pairByEvent, setPairByEvent] = useState<Map<number, PairState>>(new Map());
  const pairByEventRef = useRef(pairByEvent);
  useEffect(() => { pairByEventRef.current = pairByEvent; }, [pairByEvent]);

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
  // Toast in-app: bật/tắt popup. Mặc định BẬT (chỉ tắt khi localStorage = '0').
  const [toastOn, setToastOn] = useState(true);
  const toastOnRef = useRef(true);

  useEffect(() => {
    const g = localStorage.getItem('gs_os_noti_goal') === '1';
    const h = localStorage.getItem('gs_os_noti_ht') === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h);   osNotiHTRef.current = h;
    const t = localStorage.getItem('gs_toast_rank') !== '0';
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
        // LUÔN gộp 2 chiều đối đầu (A vs B + B vs A) — both=1 cố định.
        const res = await fetch(`/api/gs-h2h-splits?pairs=${pairsParam}&limit=${limit}&both=1`, { cache: 'no-store' });
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

  // Chế độ 'h2h': fetch Tài/Xỉu lịch sử cho từng trận đang hiện — chỉ cái CHƯA có
  // trong cache (loading/error/ready đều coi là "đã có"). Vài trận live nên fetch
  // per-event OK; đổi mode qua lại không refetch nhờ cache theo eventId.
  const liveEventIdsKey = sorted.map((m) => m.eventId).join(',');
  useEffect(() => {
    if (rankMode !== 'h2h') return;
    const missing = sorted
      .map((m) => m.eventId)
      .filter((id) => !pairByEventRef.current.has(id));
    if (missing.length === 0) return;
    let alive = true;
    // Đánh dấu loading ngay để hiện spinner per-box, tránh fetch trùng.
    setPairByEvent((prev) => {
      const next = new Map(prev);
      for (const id of missing) next.set(id, { status: 'loading' });
      return next;
    });
    for (const id of missing) {
      fetch(`/api/gs-h2h-pair?eventId=${id}`, { cache: 'no-store' })
        .then(async (r) => {
          const json = (await r.json()) as { ok: boolean } & Partial<H2HPair>;
          if (!alive) return;
          setPairByEvent((prev) => {
            const next = new Map(prev);
            next.set(id, json.ok
              ? { status: 'ready', ft: json.ft ?? null, h1: json.h1 ?? null }
              : { status: 'error' });
            return next;
          });
        })
        .catch(() => {
          if (!alive) return;
          setPairByEvent((prev) => new Map(prev).set(id, { status: 'error' }));
        });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankMode, liveEventIdsKey]);

  const group16 = sorted.filter((m) => m.leagueId === LEAGUE_16P);
  const group20 = sorted.filter((m) => m.leagueId === LEAGUE_20P);

  const leagueName16 = group16[0]?.leagueName ?? '16 Phút';
  const leagueName20 = group20[0]?.leagueName ?? '20 Phút';

  // Badge thẻ đỏ — hiện ô đỏ + số lượng khi đội có ≥1 thẻ đỏ, ẩn khi 0.
  function RedCardBadge({ n }: { n: number }) {
    if (!n || n <= 0) return null;
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5" title={`${n} thẻ đỏ`}>
        <span className="inline-block h-[13px] w-[9px] rounded-[2px] bg-[#ef4444] shadow-[0_0_3px_rgba(239,68,68,.6)]" />
        {n > 1 && <span className="text-[10px] font-bold tabular-nums text-[#ef4444]">×{n}</span>}
      </span>
    );
  }

  function MatchBox({ m }: { m: GsLiveMatch }) {
    const isHT = m.period === 4;
    const scored = scoredIds.has(m.eventId);
    const h1Final = h1Finals.get(m.eventId);
    const phase = phaseParts(m, nowMs);
    // Hiệp đang diễn ra → tô nền cam box tương ứng (phân biệt đang H1 hay H2).
    const activeHalf = phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'h2' : null;
    // Kiểu 'h2h' chỉ có box FT + H1 → map hiệp đang đá sang market active:
    // đang H1 → box H1; đang H2 → box FT (H2 không có box riêng, FT là market đang chạy).
    const activeMarket = phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'ft' : null;
    // H2H theo hiệp: LUÔN hiện cả 2 box (H2 + H1) ở vị trí cố định, bất kể phase —
    // không collapse còn 1 box khi sang H2 (tránh layout nhảy/lệch). Ở H2, box H1
    // vẫn hiện % đối đầu H1 (sp.h1); cột odds/Tài-Xỉu H1 tự về "—" vì market đã đóng.
    const sp = h2hMap.get(`${m.homeTeam}|${m.awayTeam}`);
    const meetings = sp?.meetings ?? 0;
    const halves = sp && meetings > 0
      ? [{ key: 'h2', label: 'H2', s: sp.h2 }, { key: 'h1', label: 'H1', s: sp.h1 }]
      : [];
    const boxClass = `rounded-lg border p-3 w-full min-w-0 h-full transition-all cursor-pointer hover:border-[#444] ${
      scored
        ? 'border-[#22c55e]/60 !bg-[#16a34a]/15'
        : isHT
        ? 'border-amber-500/50 bg-amber-900/10'
        : 'border-[#2a2a2a] bg-[#141414]'
    }`;
    // ── Layout "Gọn Tài/Xỉu": ẩn cột 1X2, xếp dọc (dòng 1 đội+tỉ số+phase, dòng 2 hai box hiệp) ──
    return (
      <div
        data-event-id={m.eventId}
        role="button"
        onClick={() => setSelected(m)}
        className={`${boxClass} flex flex-col gap-2`}
      >
          {/* Dòng 1: tên đội + tỉ số (trái) · phase (phải) */}
          <div className="flex items-center justify-between gap-2 md:gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2 md:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[13px] md:text-[14px] font-semibold text-white leading-tight">
                  <span className="truncate">{m.homeTeam}</span>
                  <RedCardBadge n={m.redHome} />
                </div>
                <div className="text-[10px] text-[#666] my-0.5 leading-tight">Hoà</div>
                <div className="flex items-center gap-1 text-[12px] md:text-[13px] text-[#888] leading-tight">
                  <span className="truncate">{m.awayTeam}</span>
                  <RedCardBadge n={m.redAway} />
                </div>
              </div>
              <div className="shrink-0">
                <div className={`text-[18px] md:text-[20px] font-bold leading-none ${scored ? 'text-[#22c55e]' : 'text-[#fbbf24]'}`}>
                  {m.h1Home} - {m.h1Away}
                </div>
                {m.isH2 && h1Final && (
                  <div className="text-[10px] text-[#aaa] mt-0.5">H1: {h1Final.home}-{h1Final.away}</div>
                )}
              </div>
            </div>
            <div className="flex w-[52px] md:w-[60px] flex-col items-center justify-center text-center shrink-0 border-l border-[#222] pl-2 md:pl-3">
              <div className="text-[26px] md:text-[30px] font-extrabold leading-none" style={{ color: phase.color }}>
                {phase.big}
              </div>
              {phase.small && (
                <div className="text-[12px] md:text-[13px] font-semibold text-[#aaa] mt-1">{phase.small}</div>
              )}
            </div>
          </div>
          {/* Dòng 2: 2 box cạnh nhau. Kiểu 'live' = %đối đầu + Tài/Xỉu live theo hiệp
              (H2/H1); Kiểu 'h2h' = Tài%/Xỉu% lịch sử đối đầu (FT/H1). Cùng khung box. */}
          {rankMode === 'live' ? (
            <div className="flex gap-2.5">
              {halves.length === 0 ? (
                <span className="flex items-center text-[11px] text-[#555]">ĐĐ —</span>
              ) : (
                halves.map((h) => {
                  const active = h.key === activeHalf;
                  // Tài/Xỉu live theo hiệp: H1 → market H1, H2 → toàn trận. Lấy dòng chính [0].
                  const ou = h.key === 'h1' ? m.ouH1Lines?.[0] : m.ouLines?.[0];
                  const fmtOu = (v: string | null | undefined) => (v == null || v === '' ? '—' : v);
                  return (
                    <div
                      key={h.key}
                      className={`flex flex-1 min-w-0 flex-col items-center rounded-md border px-2 py-1.5 md:px-3 ${
                        active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
                      }`}
                    >
                      {/* Header: hiệp + số trận */}
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">
                        {h.label} <span className="normal-case tracking-normal text-[#555]">n={meetings}</span>
                      </span>
                      {/* %đối đầu: nhà xanh · hoà xám · khách đỏ */}
                      <div className="mt-0.5 flex items-center justify-center gap-2.5 md:gap-4 text-center">
                        <span className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#4ade80] leading-tight">{h.s.aWinPct}%</span>
                        <span className="text-[12px] md:text-[13px] font-bold tabular-nums text-[#8a8a8a] leading-tight">{h.s.drawPct}%</span>
                        <span className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#fb7185] leading-tight">{h.s.bWinPct}%</span>
                      </div>
                      {/* Tài/Xỉu live: line trên cùng, rồi Tài / Xỉu mỗi dòng. Ẩn giá trị khi market đóng. */}
                      <div className="mt-1.5 w-full border-t border-[#2a2a2a] pt-1">
                        <div className="text-center text-[9px] font-semibold uppercase tracking-wide text-[#777] leading-tight">
                          T/X <span className="text-[#aaa] tabular-nums">{fmtOu(ou?.line)}</span>
                        </div>
                        {/* Cụm Tài/Xỉu canh giữa, rộng cố định — không giãn hở khi box desktop rộng */}
                        <div className="mx-auto mt-1 flex w-fit min-w-[72px] flex-col gap-0.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#666]">Tài</span>
                            <span className="text-[13px] md:text-[14px] font-bold tabular-nums text-[#4ade80] leading-tight">{fmtOu(ou?.over)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#666]">Xỉu</span>
                            <span className="text-[13px] md:text-[14px] font-bold tabular-nums text-[#fb7185] leading-tight">{fmtOu(ou?.under)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <PairH2HRow eventId={m.eventId} activeMarket={activeMarket} />
          )}
        </div>
      );
  }

  // Dòng 2 của Kiểu 'h2h': 2 box FT + H1 (cùng khung box gọn như Kiểu 'live').
  // Trong lúc chờ /api/gs-h2h-pair → spinner per-box; lỗi → "—"; sẵn → Tài%/Xỉu%.
  function PairStatBox({ label, stat, active }: { label: string; stat: H2HPairStat | null; active?: boolean }) {
    return (
      <div
        className={`flex flex-1 min-w-0 flex-col items-center rounded-md border px-2 py-1.5 md:px-3 ${
          active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
        }`}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">
          {label} <span className="normal-case tracking-normal text-[#555]">n={stat?.n ?? 0}</span>
        </span>
        {!stat || stat.n === 0 ? (
          <div className="mt-1 text-[11px] text-[#555]">chưa đủ</div>
        ) : (
          <>
            {/* Tài% · Xỉu% — cùng cỡ chữ như Kiểu 'live' */}
            <div className="mt-0.5 flex items-center justify-center gap-3 md:gap-4 text-center">
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-[#4ade80]/70">Tài</div>
                <div className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#4ade80]">{pct(stat.overPct)}</div>
                <div className="text-[8px] tabular-nums text-[#6f6f6f]">{stat.over}/{stat.n}</div>
              </div>
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-[#fb7185]/70">Xỉu</div>
                <div className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#fb7185]">{pct(stat.n > 0 ? stat.under / stat.n : 0)}</div>
                <div className="text-[8px] tabular-nums text-[#6f6f6f]">{stat.under}/{stat.n}</div>
              </div>
            </div>
            {/* TB bàn · chênh */}
            <div className="mt-1 w-full border-t border-[#2a2a2a] pt-1 text-center text-[9px] text-[#888] leading-tight">
              TB <span className="text-[#bbb] tabular-nums">{stat.avgTotal.toFixed(1)}</span> · chênh{' '}
              <span className="tabular-nums" style={{ color: stat.avgMargin >= 0 ? '#4ade80' : '#f87171' }}>
                {stat.avgMargin > 0 ? '+' : ''}{stat.avgMargin.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  function PairH2HRow({ eventId, activeMarket }: { eventId: number; activeMarket: 'ft' | 'h1' | null }) {
    const st = pairByEvent.get(eventId);
    if (!st || st.status === 'loading') {
      return (
        <div className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#1c1c1c] py-3 text-[11px] text-[#17a2b8]">
          <Spinner size={13} /> Đang tải đối đầu…
        </div>
      );
    }
    if (st.status === 'error') {
      return (
        <div className="flex min-h-[64px] items-center justify-center rounded-md border border-[#2a2a2a] bg-[#1c1c1c] py-3 text-[11px] text-[#777]">
          Không tải được đối đầu
        </div>
      );
    }
    return (
      <div className="flex gap-2.5">
        <PairStatBox label="FT" stat={st.ft} active={activeMarket === 'ft'} />
        <PairStatBox label="H1" stat={st.h1} active={activeMarket === 'h1'} />
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
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 items-stretch">
          {items.map((m) => <MatchBox key={m.eventId} m={m} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
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
        {/* Bật/tắt toast popup trong app */}
        <button
          type="button"
          onClick={() => {
            const next = !toastOn;
            setToastOn(next); toastOnRef.current = next;
            localStorage.setItem('gs_toast_rank', next ? '1' : '0');
          }}
          className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${toastOn ? 'border-[#17a2b8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
          title={toastOn ? 'Tắt toast popup trong app' : 'Bật toast popup trong app'}
        >
          {toastOn ? '💬 Toast ON' : '🔕 Toast OFF'}
        </button>
        {/* Switch kiểu hiển thị list: Live (Tài/Xỉu theo hiệp) ↔ Đối đầu T/X (lịch sử FT/H1) */}
        <button
          type="button"
          onClick={toggleRankMode}
          className={`ml-auto rounded px-2 py-0.5 text-[11px] border transition-colors ${rankMode === 'h2h' ? 'border-[#f59e0b]/50 text-[#fbbf24] bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25' : 'border-[#17a2b8]/50 text-[#22d3ee] bg-[#17a2b8]/15 hover:bg-[#17a2b8]/25'}`}
          title={rankMode === 'h2h' ? 'Đang xem Tài/Xỉu lịch sử đối đầu — bấm để về Live theo hiệp' : 'Đang xem Tài/Xỉu Live theo hiệp — bấm để xem lịch sử đối đầu T/X'}
        >
          {rankMode === 'h2h' ? '🎯 Đối đầu T/X' : '📊 Live'}
        </button>
        {/* Filter số trận đối đầu để tính % */}
        <div className="flex items-center gap-1">
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
          <LeagueGroup title={leagueName16} items={group16} />
          <LeagueGroup title={leagueName20} items={group20} />
        </>
      )}

      {selected && (() => {
        // Danh sách phẳng theo đúng thứ tự hiển thị (group16 rồi group20).
        const flat = [...group16, ...group20];
        const n = flat.length;
        const idx = flat.findIndex((m) => m.eventId === selected.eventId);
        // Vòng lặp vô hạn: cuối → về đầu, đầu → về cuối (chỉ cần >1 trận).
        const canCycle = idx >= 0 && n > 1;
        // Market đang chạy của trận đang mở → tô cam thẻ tương ứng trong tab Tài/Xỉu
        // (đồng bộ Kiểu 2 ở list): H1→'h1', H2→'ft', còn lại (HT/chờ/KT)→null.
        // phase live đổi theo nowMs nên card cam tự cập nhật khi sang hiệp.
        const selPhase = phaseParts(selected, nowMs).big;
        const drawerActiveMarket = selPhase === 'H1' ? 'h1' : selPhase === 'H2' ? 'ft' : null;
        return (
          <MatchDetailDrawer
            eventId={selected.eventId}
            home={selected.homeTeam}
            away={selected.awayTeam}
            initialTab="ou"
            activeMarket={drawerActiveMarket}
            onClose={() => setSelected(null)}
            hasPrev={canCycle}
            hasNext={canCycle}
            onPrev={canCycle ? () => setSelected(flat[(idx - 1 + n) % n]) : undefined}
            onNext={canCycle ? () => setSelected(flat[(idx + 1) % n]) : undefined}
          />
        );
      })()}
    </div>
  );
}
