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
  | { status: 'ready'; ft: H2HPairStat | null; h1: H2HPairStat | null; h1Totals: number[]; ftTotals: number[] };

const GS_STREAM_TOKEN = process.env.NEXT_PUBLIC_GS_TOKEN ?? '';

const LEAGUE_16P = 2140;
const LEAGUE_20P = 2125;

// ── Gợi ý Tài/Xỉu deterministic (EMPIRICAL) — hằng số, mỗi cái có lý do (§6 SPEC) ──
const N_MIN = 8;              // dưới 8 trận đối đầu có line → phân phối quá nhiễu (bài học 0-0→Tài GIẢ)
const P_MIN_VAO = 0.70;       // cửa nghiêng phải đạt P≥70% mới được suggest VÀO; dưới ngưỡng = lưỡng lự → không đẩy cửa nào
const PRICE_MIN_VAO = 0.70;   // giá Malay cửa vào phải >0.7 (dương payout tốt) HOẶC âm; khoảng (0,0.7] = dương nhỏ payout tệ → không suggest vào odd đó
const BUFFER_EV = 0.06;       // biên xác suất phải thắng thị trường ≥6% mới VÀO (bù ước lượng + vig + sai số join)
const BUFFER_EV_H2 = 0.10;    // H2 leg suy ra (FT−H1) kém tin → biên rộng hơn
const LAPLACE_A = 1;          // làm mịn Laplace: 0/10 → ~8%, 10/10 → ~92% (không 0/100% tuyệt đối)

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Parse line "2.5" | "3" | "2.5-3" (quarter). Trả null nếu rỗng/không parse được.
function parseLine(raw?: string | null): { lineVal: number; isQuarter: boolean; loLine: number; hiLine: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // Quarter "a-b" — mỗi vế có thể ÂM (H2 line quy đổi = lineFT − H1 final có thể xuống <0).
  // Dùng regex để không vỡ ở dấu trừ dẫn đầu (split('-') sẽ cắt nhầm "-0.5-0").
  const q = s.match(/^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/);
  if (q) {
    const a = Number(q[1]), b = Number(q[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { lineVal: (a + b) / 2, isQuarter: true, loLine: a, hiLine: b };
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return { lineVal: v, isQuarter: false, loLine: v, hiLine: v };
}

// Quy line FT về hệ HIỆP 2: lineH2 = lineFT − tổng bàn H1 cuối (§3.2). Giữ dạng quarter
// ("2.5-3" → trừ cả 2 mức) để parseLine ở computeSignal vẫn nội suy 50/50 đúng.
// Trả string để tái dùng parseLine; null khi line rỗng/không parse được.
function adjustLineH2(raw: string | null | undefined, h1FinalTotal: number): string | null {
  const parsed = parseLine(raw);
  if (!parsed) return null;
  if (parsed.isQuarter) return `${parsed.loLine - h1FinalTotal}-${parsed.hiLine - h1FinalTotal}`;
  return String(parsed.lineVal - h1FinalTotal);
}

// Xác suất Malay hoà vốn ngụ ý bởi giá m (đảo của implied): m>0 → 1/(1+m); m<0 → |m|/(1+|m|).
function malayToProb(m: number): number {
  if (m === 0) return 0.5;
  if (m > 0) return 1 / (1 + m);
  return -m / (1 - m); // m<0 → |m|/(1+|m|)
}

// P → giá Malay fair (đảo malayToProb). p>=0.5 → giá dương nhỏ (odds-on); else giá âm.
function malayFair(p: number): number {
  const pc = clamp01(p);
  if (pc >= 0.5) return (1 - pc) / pc;
  return -(pc / (1 - pc));
}

// P(Tài) EMPIRICAL cho MỘT mức line, có làm mịn Laplace + override realtime (§3.1).
//   totals = mảng tổng bàn của N trận đối đầu (đã filter theo leg đang xét).
//   scored = tổng bàn HIỆN TẠI của market/leg đang đá.
// PUSH (t == line, chỉ khi line nguyên): KHÔNG tính là over (hoà không phải Tài) → về phía Xỉu.
function pTaiEmpirical(line: number, scored: number, totals: number[]): number {
  if (scored > line) return 1;              // tỉ số đã vượt line → Tài chắc thắng (override)
  const n = totals.length;
  if (n === 0) return NaN;                  // rỗng → caller ẩn (không bịa)
  const over = totals.reduce((c, t) => c + (t > line ? 1 : 0), 0); // push (t==line) KHÔNG tính over
  return (over + LAPLACE_A) / (n + 2 * LAPLACE_A);
}

// Ngưỡng "trần" H1 của cặp = số bàn H1 cao nhất từng xảy ra trong lịch sử đối đầu (§4.1).
// Rỗng → không guard được → Infinity (không kích hoạt).
function h1Ceiling(h1Totals: number[]): number {
  return h1Totals.length ? Math.max(...h1Totals) : Infinity;
}

type TxSignal =
  | { kind: 'vao'; side: 'tai' | 'xiu'; price: string; pct: number; line: string; lowConf: boolean }
  | { kind: 'cho'; side: 'tai' | 'xiu'; waitPrice: number; pct: number; lowConf: boolean }
  | { kind: 'none'; lowConf: boolean }
  | { kind: 'break'; scope: 'h1' | 'h2'; lowConf: boolean }   // ← lệch quy luật (phá trần lịch sử)
  | null;

// Tính tín hiệu Tài/Xỉu cho market đang đá. Trả null khi thiếu điều kiện (§7) → ẩn dòng.
// TÍNH INLINE mỗi render (2s) — KHÔNG memo, KHÔNG cache theo eventId (§10 #8).
// EMPIRICAL: P(Tài) đếm phân phối tổng bàn thực `totals` (đã filter theo leg), làm mịn Laplace.
// H2 leg: caller đã trừ H1 final khỏi line + scored + truyền h2Totals (§3.2).
function computeSignal(args: {
  totals: number[];          // mảng tổng bàn N trận ĐĐ theo leg (H1: h1Totals; H2: ftTotals−h1Totals)
  lowConf: boolean;          // H2 leg
  scored: number;            // bàn đã ghi trong market/leg đang đá (đã quy về hệ leg)
  lineRaw: string | null | undefined;   // line đã quy về hệ leg (H2: đã trừ H1 final)
  overRaw: string | null | undefined;  // giá Malay cửa Tài
  underRaw: string | null | undefined; // giá Malay cửa Xỉu
}): TxSignal {
  const parsed = parseLine(args.lineRaw);
  if (!parsed) return null;            // line không parse được → ẩn

  // P(Tài) empirical: quarter → nội suy 50/50 hai mức; else một mức. NaN (totals rỗng) → ẩn.
  const pTai = parsed.isQuarter
    ? (pTaiEmpirical(parsed.loLine, args.scored, args.totals) + pTaiEmpirical(parsed.hiLine, args.scored, args.totals)) / 2
    : pTaiEmpirical(parsed.lineVal, args.scored, args.totals);
  if (!Number.isFinite(pTai)) return null; // totals rỗng → NaN → ẩn
  const pXiu = 1 - pTai;

  // Cửa nghiêng + giá live tương ứng.
  const leanTai = pTai >= pXiu;
  const p = leanTai ? pTai : pXiu;
  const priceRaw = leanTai ? args.overRaw : args.underRaw;
  const priceNum = priceRaw == null || priceRaw === '' ? NaN : Number(priceRaw);
  if (!Number.isFinite(priceNum)) return null; // giá cửa nghiêng không parse được → market đóng → ẩn

  const side: 'tai' | 'xiu' = leanTai ? 'tai' : 'xiu';
  const buffer = args.lowConf ? BUFFER_EV_H2 : BUFFER_EV;
  const edgeProb = p - malayToProb(priceNum); // P ta ước lượng − P thị trường ngụ ý

  // Lưỡng lự: cửa nghiêng chưa đạt ngưỡng tự tin P≥70% → KHÔNG suggest vào cửa nào.
  if (p < P_MIN_VAO) {
    return { kind: 'none', lowConf: args.lowConf };
  }
  // Giá cửa vào phải đáng tiền: Malay > 0.7 HOẶC âm. Khoảng (0, 0.7] = dương nhỏ payout tệ → không VÀO odd đó.
  const priceEnterable = priceNum > PRICE_MIN_VAO || priceNum < 0;

  if (edgeProb >= buffer && priceEnterable) {
    return { kind: 'vao', side, price: String(priceRaw), pct: p, line: String(parsed.lineVal % 1 === 0 ? parsed.lineVal : args.lineRaw), lowConf: args.lowConf };
  }
  if (edgeProb < 0) {
    return { kind: 'none', lowConf: args.lowConf }; // ta còn thấp hơn thị trường → chưa có kèo rõ
  }
  // Chờ giá: mốc theo EV (malayToProb = p − buffer). Nếu cửa dương mà mốc EV vẫn ở band xấu
  // (0, 0.7] → nâng mốc chờ lên PRICE_MIN_VAO để chỉ vào khi odd đáng tiền (>0.7).
  const evWait = malayFair(clamp01(p - buffer));
  const waitPrice = evWait >= 0 && evWait <= PRICE_MIN_VAO ? PRICE_MIN_VAO : evWait;
  return { kind: 'cho', side, waitPrice, pct: p, lowConf: args.lowConf };
}

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
  // View gộp: mỗi trận hiện CẢ 2 hàng — hàng trên = Tài/Xỉu odds live theo hiệp
  // (H2/H1), hàng dưới = Tài/Xỉu LỊCH SỬ đối đầu cặp đó (FT/H1, từ /api/gs-h2h-pair).
  // Cache H2H Tài/Xỉu lịch sử theo eventId (chỉ fetch cái chưa có).
  const [pairByEvent, setPairByEvent] = useState<Map<number, PairState>>(new Map());
  const pairByEventRef = useRef(pairByEvent);
  useEffect(() => { pairByEventRef.current = pairByEvent; }, [pairByEvent]);

  // Nhịp retry cho trận lỗi tải đối đầu — quét lại đều đặn, đừng để kẹt "Không tải được"/empty.
  const [pairRetryTick, setPairRetryTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPairRetryTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

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

  // Fetch Tài/Xỉu lịch sử đối đầu cho từng trận đang hiện — chỉ cái CHƯA có
  // trong cache (loading/error/ready đều coi là "đã có"). Vài trận live nên fetch
  // per-event OK; cache theo eventId nên không refetch trận đã có.
  const liveEventIdsKey = sorted.map((m) => m.eventId).join(',');
  useEffect(() => {
    // Fetch cái CHƯA có + retry cái đang 'error' (mỗi nhịp pairRetryTick) — đừng để kẹt lỗi.
    const toFetch = sorted
      .map((m) => m.eventId)
      .filter((id) => {
        const s = pairByEventRef.current.get(id);
        return !s || s.status === 'error';
      });
    if (toFetch.length === 0) return;
    let alive = true;
    // Chỉ set 'loading' cho cái CHƯA có (giữ text lỗi khi retry, không nháy spinner).
    const fresh = toFetch.filter((id) => !pairByEventRef.current.has(id));
    if (fresh.length > 0) {
      setPairByEvent((prev) => {
        const next = new Map(prev);
        for (const id of fresh) next.set(id, { status: 'loading' });
        return next;
      });
    }
    for (const id of toFetch) {
      fetch(`/api/gs-h2h-pair?eventId=${id}`, { cache: 'no-store' })
        .then(async (r) => {
          const json = (await r.json()) as { ok: boolean } & Partial<H2HPair>;
          if (!alive) return;
          setPairByEvent((prev) => {
            const next = new Map(prev);
            next.set(id, json.ok
              ? { status: 'ready', ft: json.ft ?? null, h1: json.h1 ?? null, h1Totals: json.h1Totals ?? [], ftTotals: json.ftTotals ?? [] }
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
  }, [liveEventIdsKey, pairRetryTick]);

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
      ? [{ key: 'h2', label: 'Tỉ lệ Thắng Hiệp 2', s: sp.h2 }, { key: 'h1', label: 'Tỉ lệ Thắng H1', s: sp.h1 }]
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
          {/* Dòng 2 (trên): 2 box Tài/Xỉu odds LIVE theo hiệp (H2/H1) + %đối đầu. */}
          <div className="flex gap-2.5">
              {halves.length === 0 ? (
                <span className="flex items-center text-[11px] text-[#555]">ĐĐ —</span>
              ) : (
                halves.map((h) => {
                  const active = h.key === activeHalf;
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
                    </div>
                  );
                })
              )}
          </div>
          {/* Dòng 3 (dưới): 2 box số liệu % Tài/Xỉu LỊCH SỬ đối đầu (FT/H1). */}
          <PairH2HRow eventId={m.eventId} activeMarket={activeMarket} ftLine={m.ouLines?.[0]?.line} h1Line={m.ouH1Lines?.[0]?.line} />
          {/* Dòng gợi ý Tài/Xỉu deterministic — tính inline mỗi 2s (§5). */}
          <TxSuggestionRow m={m} activeMarket={activeMarket} h1Final={h1Final} />
        </div>
      );
  }

  // Dòng 2 của Kiểu 'h2h': 2 box FT + H1 (cùng khung box gọn như Kiểu 'live').
  // Trong lúc chờ /api/gs-h2h-pair → spinner per-box; lỗi → "—"; sẵn → Tài%/Xỉu%.
  function PairStatBox({ label, title, stat, active, line }: { label: string; title?: string; stat: H2HPairStat | null; active?: boolean; line?: string | null }) {
    return (
      <div
        className={`flex flex-1 min-w-0 flex-col items-center rounded-md border px-2 py-1.5 md:px-3 ${
          active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
        }`}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">
          {title ?? label}
          {line != null && line !== '' && (
            <span className="normal-case tracking-normal text-[#aaa] tabular-nums"> · {line}</span>
          )}{' '}
          <span className="normal-case tracking-normal text-[#555]">n={stat?.n ?? 0}</span>
        </span>
        {!stat || stat.n === 0 ? (
          <div className="mt-1 text-[11px] text-[#555]">chưa đủ</div>
        ) : (
          <>
            {/* Tài% · Hoà% · Xỉu% — hoà = tổng bàn đúng bằng line (n − over − under). */}
            <div className="mt-0.5 flex items-center justify-center gap-3 md:gap-4 text-center">
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-[#4ade80]/70">Tài</div>
                <div className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#4ade80]">{pct(stat.overPct)}</div>
                <div className="text-[8px] tabular-nums text-[#6f6f6f]">{stat.over}/{stat.n}</div>
              </div>
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-[#8a8a8a]/80">Hoà</div>
                <div className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#8a8a8a]">{pct(stat.n > 0 ? (stat.n - stat.over - stat.under) / stat.n : 0)}</div>
                <div className="text-[8px] tabular-nums text-[#6f6f6f]">{stat.n - stat.over - stat.under}/{stat.n}</div>
              </div>
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-wide text-[#fb7185]/70">Xỉu</div>
                <div className="text-[14px] md:text-[15px] font-bold tabular-nums text-[#fb7185]">{pct(stat.n > 0 ? stat.under / stat.n : 0)}</div>
                <div className="text-[8px] tabular-nums text-[#6f6f6f]">{stat.under}/{stat.n}</div>
              </div>
            </div>
            {/* TB bàn · OU TB (line trung bình = TB − chênh) · chênh */}
            <div className="mt-1 w-full border-t border-[#2a2a2a] pt-1 text-center text-[9px] text-[#888] leading-tight">
              TB {label} <span className="text-[#bbb] tabular-nums">{stat.avgTotal.toFixed(1)}</span> · OU TB{' '}
              <span className="text-[#f0c674] tabular-nums">{(stat.avgTotal - stat.avgMargin).toFixed(2)}</span> · chênh{' '}
              <span className="tabular-nums" style={{ color: stat.avgMargin >= 0 ? '#4ade80' : '#f87171' }}>
                {stat.avgMargin > 0 ? '+' : ''}{stat.avgMargin.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  function PairH2HRow({ eventId, activeMarket, ftLine, h1Line }: { eventId: number; activeMarket: 'ft' | 'h1' | null; ftLine?: string | null; h1Line?: string | null }) {
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
        <PairStatBox label="FT" title="Chỉ số TB Tài Xỉu FT" stat={st.ft} active={activeMarket === 'ft'} line={ftLine} />
        <PairStatBox label="H1" title="Chỉ số TB Tài Xỉu H1" stat={st.h1} active={activeMarket === 'h1'} line={h1Line} />
      </div>
    );
  }

  // Dòng gợi ý Tài/Xỉu (EMPIRICAL, deterministic). Tính INLINE mỗi render 2s từ tỉ số +
  // phân phối tổng bàn ĐĐ HIỆN TẠI → có bàn vào là verdict tự đổi (không memo, không cache theo eventId).
  function TxSuggestionRow({ m, activeMarket, h1Final }: { m: GsLiveMatch; activeMarket: 'ft' | 'h1' | null; h1Final?: { home: number; away: number } }) {
    // Placeholder mờ để MỌI trận đều có dòng (bật tất cả các trận) — không ẩn hẳn.
    const phBox = 'mt-1 flex items-center justify-center text-[11px] font-normal text-[#4b5563]';
    const ph = (text: string) => <div className={phBox}>{text}</div>;
    // Không live / chưa vào hiệp (HT/Chờ/KT) → chưa có kèo để gợi ý.
    if (!m.isLive || activeMarket === null) return ph('⏸ chưa vào kèo');
    const st = pairByEvent.get(m.eventId);
    if (!st || st.status !== 'ready') return ph('⏳ đang tải đối đầu…');

    const lowConf = activeMarket === 'ft'; // FT khi đang H2 = leg H2 (suy ra) → độ tin thấp
    const tip = lowConf ? 'H2 ước lượng (FT−H1), độ tin thấp' : undefined;
    const approx = lowConf ? '≈ ' : ''; // nhãn ước lượng cho H2 leg
    const container = 'mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 text-[13px] md:text-[14px] font-semibold tabular-nums';
    // Lệch quy luật (phá trần lịch sử): màu xám-vàng cảnh báo, KHÔNG ra kèo (§4.4).
    const breakRow = (scope: 'h1' | 'h2') => (
      <div className={container} title={scope === 'h2' ? 'H1 phá trần lịch sử → phân phối H2 hết đại diện' : 'Tỉ số H1 vượt mọi trận đối đầu → phân phối hết đại diện'} style={{ color: '#d4a72c' }}>
        <span className="font-normal">{approx}⚠ lệch quy luật{scope === 'h2' ? ' (H1 phá trần)' : ''}</span>
      </div>
    );

    const { h1Totals, ftTotals } = st;
    // Tổng bàn HIỆN TẠI (cả trận). H2 leg quy về hệ H2 phía dưới.
    const scoredNow = m.h1Home + m.h1Away;

    let totals: number[];
    let scored: number;
    let lineRaw: string | null | undefined;
    let overRaw: string | null | undefined;
    let underRaw: string | null | undefined;

    if (activeMarket === 'h1') {
      // Gate đếm trên ĐỘ DÀI MẢNG dùng (không phải stat.n — §4.1/§5.5).
      if (h1Totals.length < N_MIN) return ph(`— chưa đủ đối đầu (n<${N_MIN})`);
      // GUARD phá trần H1 (§4.3): đang H1 & scored vượt max lịch sử nhưng CHƯA tới line → lệch quy luật.
      // Nếu đã vượt line (scored>line) → để computeSignal ra VÀO TÀI (override), guard nhường.
      const lineH1 = parseLine(m.ouH1Lines?.[0]?.line)?.lineVal;
      if (scoredNow > h1Ceiling(h1Totals) && !(lineH1 != null && scoredNow > lineH1)) {
        return breakRow('h1');
      }
      totals = h1Totals;
      scored = scoredNow;
      lineRaw = m.ouH1Lines?.[0]?.line;
      overRaw = m.ouH1Lines?.[0]?.over;
      underRaw = m.ouH1Lines?.[0]?.under;
    } else {
      // H2 leg: cần ĐỦ mảng đồng bộ (ft/h1 length bằng nhau) + có mốc cuối H1 (h1Final).
      if (ftTotals.length < N_MIN) return ph(`— chưa đủ đối đầu (n<${N_MIN})`);
      if (!h1Final) return ph('— chờ mốc cuối H1');
      const h1FinalTotal = h1Final.home + h1Final.away;
      // GUARD phá trần H2 (§4.3): H1 đã kết & tổng H1 > max lịch sử → empirical H2 hết tin → lệch quy luật.
      if (h1FinalTotal > h1Ceiling(h1Totals)) return breakRow('h2');
      // Phân phối bàn HIỆP 2 lịch sử (đồng bộ index → đúng trận). Line & scored quy về hệ H2.
      totals = ftTotals.map((ft, i) => ft - h1Totals[i]);
      scored = Math.max(0, scoredNow - h1FinalTotal); // bàn đã ghi trong H2 (clamp ≥0)
      lineRaw = adjustLineH2(m.ouLines?.[0]?.line, h1FinalTotal); // lineH2 = lineFT − tổng bàn H1 cuối
      overRaw = m.ouLines?.[0]?.over;
      underRaw = m.ouLines?.[0]?.under;
    }

    const sig = computeSignal({ totals, lowConf, scored, lineRaw, overRaw, underRaw });
    if (!sig) return ph('— chưa có line kèo'); // thiếu line/giá → placeholder (KHÔNG show VÀO khi thiếu số liệu)

    if (sig.kind === 'vao') {
      const tai = sig.side === 'tai';
      return (
        <div className={container} title={tip} style={{ color: tai ? '#4ade80' : '#fb7185' }}>
          <span>{approx}⚡ VÀO {tai ? 'TÀI' : 'XỈU'} · giá <span className="text-[17px] md:text-[19px] font-extrabold">{Number(sig.price).toFixed(2)}</span></span>
          <span className="text-[13px] md:text-[14px] font-normal text-[#9aa4b2]">(P~{Math.round(sig.pct * 100)}% · line {sig.line})</span>
        </div>
      );
    }
    if (sig.kind === 'cho') {
      const tai = sig.side === 'tai';
      const curOdd = tai ? overRaw : underRaw; // giá ODD hiện tại của cửa nghiêng (realtime)
      return (
        <div className={container} title={tip} style={{ color: '#9ca3af' }}>
          <span>{approx}⏳ Chờ {tai ? 'Tài' : 'Xỉu'} · giá nay <span className="text-[15px] md:text-[16px] font-bold text-[#cbd5e1]">{curOdd != null && curOdd !== '' ? Number(curOdd).toFixed(2) : '—'}</span> → vào khi ~<span className="text-[17px] md:text-[19px] font-extrabold">{sig.waitPrice.toFixed(2)}</span></span>
          <span className="text-[13px] md:text-[14px] font-normal text-[#9aa4b2]">(P~{Math.round(sig.pct * 100)}%)</span>
        </div>
      );
    }
    // none → chưa có kèo rõ (xám mờ)
    return (
      <div className={container} title={tip} style={{ color: '#6b7280' }}>
        <span className="font-normal">{approx}— chưa có kèo rõ</span>
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
            initialTab="h2h"
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
