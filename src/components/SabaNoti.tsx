'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notiOnce } from '../lib/notiDedup';

// ── SABA shared notifications (OS goal + OS HT + in-app toast) ────────────────
// Ported from LiveVideoWall/RankingLive's notifyOS + toggle + toast machinery so
// both SabaFootballLive and SabaVideo get identical goal/HT/toast behaviour.
// Detection is client-side from the SABA API poll data (score/period diff between
// polls), same as the GS pages. Toggles persist under SABA-specific localStorage
// keys (independent from the GS video/ranking pages). Coordinator follow-up.

// localStorage keys — SABA-only so they don't collide with gs_video_* / ranking.
const LS_GOAL = 'gs_saba_os_noti_goal';
const LS_HT = 'gs_saba_os_noti_ht';
const LS_TOAST = 'gs_saba_toast';

// Trận tối thiểu cần để phát hiện goal/HT giữa các nhịp poll. Cả 2 trang map dữ
// liệu của mình về shape này trước khi gọi detect().
export interface SabaNotiMatch {
  matchId: number;          // khoá theo dõi giữa các poll (eventId = matchId ở trang Live)
  homeTeam: string;
  awayTeam: string;
  scoreHome: number;
  scoreAway: number;
  period: number | null;    // null khi API không trả (trang Video) → bỏ qua phát hiện HT
  minute: number | null;
  goalTeam?: string | null; // nếu API có: 'home'/'h' | 'away'/'a' → đặt tên đội vừa ghi bàn
}

// ── Hook: trạng thái toggle + showToast + notifyOS + detect ──────────────────
export function useSabaNoti() {
  // Toast — hàng đợi, mỗi msg ~3s (mirror LiveVideoWall).
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastQueue = useRef<{ msg: string; ok: boolean }[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainToast = useCallback(() => {
    const next = toastQueue.current.shift();
    if (!next) { setToast(null); toastTimer.current = null; return; }
    setToast(next);
    toastTimer.current = setTimeout(drainToast, 3000);
  }, []);
  const showToast = useCallback((msg: string, ok: boolean) => {
    toastQueue.current.push({ msg, ok });
    if (!toastTimer.current) drainToast();
  }, [drainToast]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // OS noti (goal/HT) mặc định TẮT; toast mặc định BẬT — khớp GS. Ref mirror để
  // vòng poll (async) đọc giá trị mới nhất.
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);
  const osNotiGoalRef = useRef(false);
  const osNotiHTRef = useRef(false);
  const [toastOn, setToastOn] = useState(true);
  const toastOnRef = useRef(true);
  useEffect(() => {
    const g = localStorage.getItem(LS_GOAL) === '1';
    const h = localStorage.getItem(LS_HT) === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h); osNotiHTRef.current = h;
    const t = localStorage.getItem(LS_TOAST) !== '0'; // chỉ '0' mới tắt
    setToastOn(t); toastOnRef.current = t;
  }, []);

  const requestAndSet = useCallback(async (
    key: string, setter: (v: boolean) => void, ref: { current: boolean },
  ) => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return;
    }
    setter(true); ref.current = true;
    localStorage.setItem(key, '1');
  }, []);

  const toggleGoal = useCallback(() => {
    if (osNotiGoalRef.current) { setOsNotiGoal(false); osNotiGoalRef.current = false; localStorage.setItem(LS_GOAL, '0'); }
    else requestAndSet(LS_GOAL, setOsNotiGoal, osNotiGoalRef);
  }, [requestAndSet]);
  const toggleHT = useCallback(() => {
    if (osNotiHTRef.current) { setOsNotiHT(false); osNotiHTRef.current = false; localStorage.setItem(LS_HT, '0'); }
    else requestAndSet(LS_HT, setOsNotiHT, osNotiHTRef);
  }, [requestAndSet]);
  const toggleToast = useCallback(() => {
    const next = !toastOnRef.current;
    setToastOn(next); toastOnRef.current = next;
    localStorage.setItem(LS_TOAST, next ? '1' : '0');
  }, []);

  const notifyOS = useCallback((kind: 'goal' | 'ht', title: string, body: string, eventId?: number) => {
    const allowed = kind === 'goal' ? osNotiGoalRef.current : osNotiHTRef.current;
    if (!allowed) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (eventId != null && !notiOnce(`saba:${kind}:${eventId}:${body.split('\n')[0]}`)) return; // chống noti trùng
    new Notification(title, { body, silent: false });
  }, []);

  // Snapshot trận ở poll TRƯỚC (keyed matchId) để diff. primed=false ở poll đầu →
  // chỉ lập baseline, KHÔNG bắn (tránh spam khi mới mở trang).
  const prevRef = useRef<Map<number, { score: number; period: number | null }>>(new Map());
  const primedRef = useRef(false);

  // Gọi mỗi poll với danh sách trận live hiện tại. So với snapshot trước:
  //  · tổng bàn tăng → goal noti/toast (đặt tên đội theo goalTeam nếu có)
  //  · period đổi sang HT (4) hoặc H1→H2 → HT noti/toast (chỉ khi period có giá trị)
  const detect = useCallback((matches: SabaNotiMatch[]) => {
    const prev = prevRef.current;
    if (primedRef.current) {
      for (const m of matches) {
        const before = prev.get(m.matchId);
        if (!before) continue;
        const total = m.scoreHome + m.scoreAway;
        const matchTime = m.minute != null ? `${m.minute}'` : '';
        // GOAL — tổng bàn tăng.
        if (total > before.score) {
          const scorer = (m.goalTeam === 'home' || m.goalTeam === 'h') ? m.homeTeam : (m.goalTeam === 'away' || m.goalTeam === 'a') ? m.awayTeam : null;
          const who = scorer ? `${scorer} ghi bàn!` : 'Ghi bàn!';
          if (toastOnRef.current) showToast(`⚽ ${who} ${m.homeTeam} ${m.scoreHome}-${m.scoreAway} ${m.awayTeam}${matchTime ? ` · ${matchTime}` : ''}`, true);
          notifyOS('goal', `⚽ ${who}`, `${m.homeTeam} ${m.scoreHome}–${m.scoreAway} ${m.awayTeam}${matchTime ? `\n${matchTime}` : ''}`, m.matchId);
        }
        // HT / hết H1 — chỉ khi API có period. HT = period 4; hoặc H1(<2)→H2(≥2).
        if (m.period != null && before.period != null) {
          const enteredHT = m.period === 4 && before.period !== 4;
          const enteredH2 = m.period >= 2 && before.period < 2 && m.period !== 4;
          if (enteredHT || enteredH2) {
            if (toastOnRef.current) showToast(`⏸️ Hết Hiệp 1 · ${m.homeTeam} ${m.scoreHome}-${m.scoreAway} ${m.awayTeam}`, true);
            notifyOS('ht', '🔔 Hết Hiệp 1', `${m.homeTeam} ${m.scoreHome}–${m.scoreAway} ${m.awayTeam}`, m.matchId);
          }
        }
      }
    }
    // Cập nhật snapshot cho poll sau.
    const next = new Map<number, { score: number; period: number | null }>();
    for (const m of matches) next.set(m.matchId, { score: m.scoreHome + m.scoreAway, period: m.period });
    prevRef.current = next;
    primedRef.current = true;
  }, [notifyOS, showToast]);

  return {
    osNotiGoal, osNotiHT, toastOn,
    toggleGoal, toggleHT, toggleToast,
    showToast, notifyOS, detect, toast,
  };
}

export type SabaNotiApi = ReturnType<typeof useSabaNoti>;

// ── 3 nút toggle (🔔 goal · ⏱ HT · 💬 toast) — dùng chung 2 trang ────────────
export function SabaNotiToggles({ noti }: { noti: SabaNotiApi }) {
  const { osNotiGoal, osNotiHT, toastOn, toggleGoal, toggleHT, toggleToast } = noti;
  return (
    <>
      <button
        type="button"
        onClick={toggleGoal}
        className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${osNotiGoal ? 'border-[#22c55e]/40 text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
        title={osNotiGoal ? 'Tắt noti ghi bàn' : 'Bật noti ghi bàn ra Macbook'}
      >
        {osNotiGoal ? '⚽ Ghi bàn ON' : '⚽ Ghi bàn OFF'}
      </button>
      <button
        type="button"
        onClick={toggleHT}
        className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${osNotiHT ? 'border-[#fbbf24]/40 text-[#fbbf24] bg-[#fbbf24]/10 hover:bg-[#fbbf24]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
        title={osNotiHT ? 'Tắt noti hết H1' : 'Bật noti hết H1 ra Macbook'}
      >
        {osNotiHT ? '🔔 Hết H1 ON' : '🔔 Hết H1 OFF'}
      </button>
      <button
        type="button"
        onClick={toggleToast}
        className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${toastOn ? 'border-[#17a2b8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
        title={toastOn ? 'Tắt toast popup trong app' : 'Bật toast popup trong app'}
      >
        {toastOn ? '💬 Toast ON' : '🔕 Toast OFF'}
      </button>
    </>
  );
}

// ── Toast host (góc dưới-phải) — dùng chung 2 trang ──────────────────────────
export function SabaToastHost({ noti }: { noti: SabaNotiApi }) {
  const { toast } = noti;
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 rounded-lg border px-3.5 py-2 text-[13px] font-medium shadow-lg ${
        toast.ok ? 'border-[#17a2b8]/50 bg-black/90 text-[#8ee]' : 'border-[#f87171]/50 bg-black/90 text-[#f87171]'
      }`}
    >
      {toast.msg}
    </div>
  );
}
