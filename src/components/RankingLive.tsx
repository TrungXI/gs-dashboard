'use client';

import { useEffect, useRef, useState } from 'react';
import type { PairResult } from '../app/api/gs-h2h-splits/route';
import type { H2HPair, H2HPairStat, H2HPairMatch } from '../lib/gsMatchesDb';
import { type GsLiveMatch, type Toast, ToastContainer } from './GSLive';
import { pct } from './H2HMatrix';
import MatchDetailDrawer from './MatchDetailDrawer';
import { Spinner } from './Spinner';
import { notiOnce } from '../lib/notiDedup';

// Kết quả fetch /api/gs-h2h-pair cho 1 trận. 'loading' | 'error' | dữ liệu H2H.
type PairState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ft: H2HPairStat | null; h1: H2HPairStat | null; h1Totals: number[]; ftTotals: number[]; matches: H2HPairMatch[] };

const GS_STREAM_TOKEN = process.env.NEXT_PUBLIC_GS_TOKEN ?? '';

const LEAGUE_16P = 2140;
const LEAGUE_20P = 2125;

// ── Gợi ý Tài/Xỉu deterministic (EMPIRICAL) — hằng số, mỗi cái có lý do (§6 SPEC) ──
const N_MIN = 8;              // dưới 8 trận đối đầu có line → phân phối quá nhiễu (bài học 0-0→Tài GIẢ)
const P_MIN_VAO = 0.70;       // P≥70% cả 2 cửa mới VÀO (về version d40266c — bỏ siết Tài bất đối xứng)
const PRICE_MIN_VAO = 0.70;   // nới lại 0.8→0.7 (bù volume); giá Malay cửa vào >0.7 HOẶC âm; (0,0.7] payout tệ → không vào
const TAI_LINE_MAX = 0.75;    // VÀO TÀI khi needed ≤ 0.75 (chuẩn data); bù volume bằng giá 0.7 + Xỉu cả 2 hiệp; vẫn loại needed=1.0
const RECENT_N = 10;          // CHỈ thống kê 10 trận đối đầu GẦN NHẤT (totals xếp mới→cũ → slice(0,10))
const BUFFER_EV = 0.06;       // biên: P_model phải hơn xác suất thị trường ≥6% mới VÀO (mức ra kèo thoải mái như bản gốc)
const BUFFER_EV_H2 = 0.10;    // H2 leg suy ra (FT−H1) kém tin → biên rộng hơn
const LAPLACE_A = 1;          // làm mịn Laplace: 0/10 → ~8%, 10/10 → ~92% (không 0/100% tuyệt đối)

// ── Drift / tempo / league-prior (self-improving, §3.2 SPEC) — additive edge nudges ──
const DRIFT_WINDOW = 2;          // ouLine mốc `window` snapshot trước làm ref
const DRIFT_UP_THRESH = 0.5;     // drift ≥ +0.5 → thị trường đẩy Tài
const DRIFT_DOWN_THRESH = 0.5;   // drift ≤ −0.5 → thị trường đẩy Xỉu
const DRIFT_EDGE_BONUS = 0.03;   // nudge biên khi drift đồng hướng cửa nghiêng
const TEMPO_REF = 6;             // corners + 0.5*cards trung tính (G2 default)
const TEMPO_K = 0.03;            // hệ số nudge biên per tempo unit
const LEAGUE_PRIOR_MIN_N = 30;   // min n bucket để blend prior
const PRIOR_BLEND_CAP = 30;      // cap prior weight để H2H không bị đè

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Bucket tổng bàn H1 để join league prior (0..6, 7 = "7+"). Khớp LEAST(h1,7) ở route.
function h1Bucket(scored: number): number {
  return Math.min(scored, 7);
}

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

// ── OU line LIVE (dải 2 box trên card) ──────────────────────────────────────
// over = giá cửa TÀI, under = giá cửa XỈU. Lấy .slice(0,2) mỗi mảng = 2 line.
type OuLine = { line: string | null; over: string | null; under: string | null; suspended?: boolean };

// Một dòng OU line: line — Tài <over> · Xỉu <under>. Line thiếu/suspended → mọi ô "—"
// (không crash, không NaN). Tài xanh lá (#4ade80), Xỉu đỏ (#fb7185) — đồng bộ card.
function OuLiveRow({ row, divider }: { row: OuLine | null; divider: boolean }) {
  const dead = !row || row.suspended;
  return (
    <div className={`flex items-center gap-1 text-[10px] md:text-[11px] tabular-nums${divider ? ' border-t border-[#222] pt-0.5' : ''}`}>
      <span className="w-[26px] md:w-[30px] shrink-0 text-right text-[#888]">{dead ? '—' : row!.line ?? '—'}</span>
      <span className="min-w-0 flex-1 truncate text-[#4ade80]">Tài <span className="font-semibold">{dead ? '—' : row!.over ?? '—'}</span></span>
      <span className="shrink-0 text-[#555]">·</span>
      <span className="min-w-0 flex-1 truncate text-[#fb7185]">Xỉu <span className="font-semibold">{dead ? '—' : row!.under ?? '—'}</span></span>
    </div>
  );
}

// Box OU line LIVE cho MỘT hiệp (H1 hoặc H2/cả trận). Luôn giữ khung 2 dòng =
// "2 kèo Tài + 2 kèo Xỉu"; thiếu line thì dòng đó hiện "—". active = hiệp ĐANG đá
// → tô viền/nền xanh da trời (đồng bộ box active "Kiểu 2" phía trên card).
function OuLiveBox({ title, lines, active = false }: { title: string; lines?: OuLine[]; active?: boolean }) {
  const src = lines ?? [];
  const rows: (OuLine | null)[] = [src[0] ?? null, src[1] ?? null];
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col rounded-md border px-2 py-1.5 ${
        active ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15' : 'border-[#2a2a2a] bg-[#1c1c1c]'
      }`}
    >
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#777]">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row, idx) => (
          <OuLiveRow key={idx} row={row} divider={idx > 0} />
        ))}
      </div>
    </div>
  );
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
// PUSH (t == line, chỉ khi line nguyên) = hoà, VÔ HIỆU → loại khỏi CẢ tử VÀ mẫu (không dồn về Xỉu).
// Trả { p, n }: p = P(Tài); n = kích thước POOL ĐÃ ĐIỀU KIỆN (t >= scored, incl. pushes) cho gate §5.5.
function pTaiEmpirical(line: number, scored: number, totals: number[]): { p: number; n: number } {
  // ĐIỀU KIỆN theo bàn ĐÃ GHI: chỉ xét trận lịch sử từng đạt ÍT NHẤT `scored` bàn. Đã "bank" scored
  // bàn thì xác suất qua line phụ thuộc lịch sử của NHÓM trận từng tới mức đó — tránh hô Xỉu khi tỉ số
  // đã sát/bằng line (vd 0-2, line 2.5). scored=0 → pool = tất cả (không đổi hành vi đầu hiệp).
  const pool = totals.filter((t) => t >= scored);
  const n = pool.length;
  if (scored > line) return { p: 1, n };    // tỉ số đã vượt line → Tài chắc thắng (override)
  if (n === 0) return { p: NaN, n: 0 };     // rỗng → caller ẩn (scored>max đã bị guard chặn trước đó)
  // PUSH (t == line) = hoà, VÔ HIỆU → loại khỏi CẢ tử VÀ mẫu (không dồn về Xỉu).
  const overs = pool.reduce((c, t) => c + (t > line ? 1 : 0), 0);
  const unders = pool.reduce((c, t) => c + (t < line ? 1 : 0), 0);
  const denom = overs + unders;             // pushes bị bỏ khỏi ước lượng
  return { p: (overs + LAPLACE_A) / (denom + 2 * LAPLACE_A), n };
}

// Ngưỡng "trần" H1 của cặp = số bàn H1 cao nhất từng xảy ra trong lịch sử đối đầu (§4.1).
// Rỗng → không guard được → Infinity (không kích hoạt).
function h1Ceiling(h1Totals: number[]): number {
  return h1Totals.length ? Math.max(...h1Totals) : Infinity;
}

type TxSignal =
  | { kind: 'vao'; side: 'tai' | 'xiu'; price: string; pct: number; line: string; lowConf: boolean }
  | { kind: 'cho'; side: 'tai' | 'xiu'; waitPrice: number; waitLine?: number; pct: number; lowConf: boolean }
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
  isS?: boolean;             // giải (S) ít bàn → ép Xỉu (v6.0)
  isV?: boolean;             // giải (V) nhiều bàn → ép Tài (v6.0)
  // ── MỚI (§3.2) — vắng hết ⇒ output byte-identical với hành vi cũ ──
  lineDriftHistory?: { line: number; scored: number; ts: number }[]; // cùng market đang xét
  cornersTotal?: number;     // cornersHome + cornersAway (H1 tempo)
  cardsWeighted?: number;    // yellow*1 + red*3, tổng 2 đội
  leaguePrior?: { pTai: number; n: number } | null; // từ /api/gs-league-priors, leak-free
}): TxSignal {
  const parsed = parseLine(args.lineRaw);
  if (!parsed) return null;            // line không parse được → ẩn

  // (BỎ gate pool-điều-kiện ≥N_MIN theo yêu cầu — chấp nhận thống kê trên mẫu nhỏ.
  //  Chỉ còn raw-length gate ở caller: cặp phải có ≥N_MIN trận trong 10 trận gần nhất.)

  // P(Tài) empirical: quarter → nội suy 50/50 hai mức; else một mức. NaN (totals rỗng) → ẩn.
  const pTai = parsed.isQuarter
    ? (pTaiEmpirical(parsed.loLine, args.scored, args.totals).p + pTaiEmpirical(parsed.hiLine, args.scored, args.totals).p) / 2
    : pTaiEmpirical(parsed.lineVal, args.scored, args.totals).p;
  if (!Number.isFinite(pTai)) return null; // pool rỗng → NaN → ẩn

  // League prior blend (§3.2 #1): thay vì hardcode (V)/(S) cho pModel, blend P(Tài) empirical
  // với prior calibrated theo cỡ mẫu. Vắng prior / n<min → pTaiForModel = pTai (không đổi gì).
  let pTaiForModel = pTai;
  if (args.leaguePrior && args.leaguePrior.n >= LEAGUE_PRIOR_MIN_N) {
    const nPool = args.totals.length;
    const capW = Math.min(args.leaguePrior.n, PRIOR_BLEND_CAP);
    pTaiForModel = (pTai * nPool + args.leaguePrior.pTai * capW) / (nPool + capW);
  }
  const pXiuForModel = 1 - pTaiForModel;

  // Cửa nghiêng LEAGUE-DRIVEN (v6.0): (V)→ép Tài, (S)→ép Xỉu, untagged→model. Gate P_MIN_VAO vẫn chặn side yếu.
  const leanTai = args.isV ? true : args.isS ? false : (pTaiForModel >= pXiuForModel);
  const pModel = leanTai ? pTaiForModel : pXiuForModel;
  const priceRaw = leanTai ? args.overRaw : args.underRaw;
  const priceNum = priceRaw == null || priceRaw === '' ? NaN : Number(priceRaw);
  if (!Number.isFinite(priceNum)) return null; // giá cửa nghiêng không parse được → market đóng → ẩn

  const side: 'tai' | 'xiu' = leanTai ? 'tai' : 'xiu';
  // TIN THỊ TRƯỜNG HƠN qua BIÊN: gate tự tin theo P_model (để CÓ ra kèo), nhưng edge phải ≥ BUFFER_EV
  // (6%, H2 = 10%) so với xác suất thị trường ĐÃ DE-VIG mới VÀO → chống value-bet overconfident mà
  // không giấu hết kèo (bug blend cũ).
  // §3: DE-VIG — chuẩn hoá implied 2 cửa để bỏ vig trước khi tính biên (edge).
  // pMarket = impSide / (impOver + impUnder). Thiếu/parse lỗi 1 cửa → fallback implied 1 cửa (như cũ).
  const parseP = (raw: string | null | undefined): number => {
    if (raw == null || raw === '') return NaN;
    const v = Number(raw);
    return Number.isFinite(v) ? malayToProb(v) : NaN;
  };
  const impOver = parseP(args.overRaw);
  const impUnder = parseP(args.underRaw);
  const impSide = leanTai ? impOver : impUnder;
  const sum = impOver + impUnder;
  const pMarket =
    Number.isFinite(impOver) && Number.isFinite(impUnder) && sum > 0
      ? impSide / sum
      : malayToProb(priceNum); // fallback: raw single-side implied (hành vi cũ)
  const p = pModel;
  const buffer = args.lowConf ? BUFFER_EV_H2 : BUFFER_EV;
  const edgeProb = p - pMarket; // biên so với thị trường đã de-vig (buffer 6% / H2 10%)

  // ── Drift + tempo nudge (§3.2 #2/#3) — confirmation, KHÔNG đổi side, chỉ cộng/trừ edgeProb ──
  let nudge = 0;
  // Drift: F1 lineDrift port. drift đồng hướng side → dễ VÀO hơn; ngược hướng → thận trọng.
  const driftHist = (args.lineDriftHistory ?? []).filter((h) => Number.isFinite(h.line));
  if (driftHist.length >= 1) {
    const refIdx = Math.max(0, driftHist.length - DRIFT_WINDOW);
    const drift = parsed.lineVal - driftHist[refIdx].line;
    let driftSide: 'tai' | 'xiu' | null = null;
    if (drift >= DRIFT_UP_THRESH) driftSide = 'tai';
    else if (drift <= -DRIFT_DOWN_THRESH) driftSide = 'xiu';
    if (driftSide !== null) {
      nudge += driftSide === side ? DRIFT_EDGE_BONUS : -DRIFT_EDGE_BONUS;
    }
  }
  // Tempo: corners + cards (mirror G2, tempo cao → nghiêng Tài). Chỉ khi caller truyền (H1 market).
  if (args.cornersTotal != null && args.cardsWeighted != null) {
    const tempo = args.cornersTotal + 0.5 * args.cardsWeighted;
    const tempoNudge = TEMPO_K * (tempo - TEMPO_REF);
    nudge += side === 'tai' ? tempoNudge : -tempoNudge;
  }
  // Clamp tổng nudge trong [-0.06, +0.06] để không lấn gate empirical.
  nudge = Math.max(-0.06, Math.min(0.06, nudge));
  const edgeProbAdjusted = edgeProb + nudge;

  // Lưỡng lự: cửa nghiêng chưa đạt ngưỡng → KHÔNG suggest. Tài giữ 70%, Xỉu hạ 60% (thử tăng volume Xỉu).
  if (p < (leanTai ? P_MIN_VAO : 0.60)) {
    return { kind: 'none', lowConf: args.lowConf };
  }
  // Giá cửa vào phải đáng tiền: Malay > 0.7 HOẶC âm. Khoảng (0, 0.7] = dương nhỏ payout tệ → không VÀO odd đó.
  const priceEnterable = priceNum > PRICE_MIN_VAO || priceNum < 0;

  if (edgeProbAdjusted >= buffer && priceEnterable) {
    // TÀI đỡ rủi ro: chỉ VÀO khi CÒN CẦN ≤ TAI_LINE_MAX bàn (needed = line − tỉ số HIỆN TẠI).
    // Vd H2 1-0 line 1.5 → cần 0.5 → VÀO ngay (KHÔNG dùng line tuyệt đối, bug chờ oan ở H2).
    if (side === 'tai' && parsed.lineVal - args.scored > TAI_LINE_MAX) {
      return { kind: 'cho', side, waitPrice: 0, waitLine: TAI_LINE_MAX, pct: p, lowConf: args.lowConf };
    }
    // Loại needed = 1.0 (đúng 1 trái nguyên) → KHÔNG vào Tài (chỉ nhận {0,0.25,0.5,0.75,1.25}).
    if (side === 'tai' && Math.abs(parsed.lineVal - args.scored - 1.0) < 1e-9) {
      return { kind: 'none', lowConf: args.lowConf };
    }
    return { kind: 'vao', side, price: String(priceRaw), pct: p, line: String(parsed.lineVal % 1 === 0 ? parsed.lineVal : args.lineRaw), lowConf: args.lowConf };
  }
  if (edgeProbAdjusted < 0) {
    return { kind: 'none', lowConf: args.lowConf }; // ta còn thấp hơn thị trường → chưa có kèo rõ
  }
  // Chờ giá: mốc theo EV (malayToProb = p − buffer). Nếu cửa dương mà mốc EV vẫn ở band xấu
  // (0, 0.7] → nâng mốc chờ lên PRICE_MIN_VAO để chỉ vào khi odd đáng tiền (>0.7).
  const evWait = malayFair(clamp01(p - buffer));
  const waitPrice = evWait >= 0 && evWait <= PRICE_MIN_VAO ? PRICE_MIN_VAO : evWait;
  return { kind: 'cho', side, waitPrice, pct: p, lowConf: args.lowConf };
}

const EMPTY_H2H = new Map<string, PairResult>();

// Xỉu chỉ vào 1 lần/hiệp: nhớ line Xỉu ĐẦU TIÊN đã hiện "VÀO" theo `${eventId}:${market}`.
// Khi line Xỉu đổi (bóng vào → line chạy) → KHÔNG gợi ý Xỉu nữa cho hiệp đó (không nhồi Xỉu).
// Xoá khi trận hết live để không phình bộ nhớ. Tài không dùng map này (Tài nhồi theo bàn thắng).
const xiuSeen = new Map<string, number[]>();

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

// 1 bàn thắng suy từ match_odds_log (payload TỐI THIỂU): e=eventId, s=side(h/a), h2=hiệp2?, m=phút, sh/sa=tỉ số.
interface GoalEvent { e: number; s: 'h' | 'a'; h2: boolean; m: number; sh: number; sa: number }

export default function RankingLive({ initialMatch = null }: { initialMatch?: number | null }) {
  const [matches, setMatches] = useState<GsLiveMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  // Cache lồng: limit (20/50/100) → (cặp đấu → kết quả). Cả 3 mức prefetch sẵn.
  const [h2hByLimit, setH2hByLimit] = useState<Map<number, Map<string, PairResult>>>(new Map());
  const [selected, setSelected] = useState<GsLiveMatch | null>(null);
  // Deep-link từ Telegram (?view=tx&match=<eventId>) → tự mở drawer đối kháng của trận đó,
  // ngay khi list live có trận khớp (chỉ 1 lần). Trận chưa/hết live → bỏ qua êm.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || initialMatch == null) return;
    const m = matches.find((x) => x.eventId === initialMatch);
    if (m) {
      setSelected(m);
      deepLinkDone.current = true;
    }
  }, [initialMatch, matches]);
  // Số trận đối đầu gần nhất để tính % — CỐ ĐỊNH 50 (đã bỏ filter 20/50/100).
  const h2hLimit = 50;
  // View gộp: mỗi trận hiện CẢ 2 hàng — hàng trên = Tài/Xỉu odds live theo hiệp
  // (H2/H1), hàng dưới = Tài/Xỉu LỊCH SỬ đối đầu cặp đó (FT/H1, từ /api/gs-h2h-pair).
  // Cache H2H Tài/Xỉu lịch sử theo eventId (chỉ fetch cái chưa có).
  const [pairByEvent, setPairByEvent] = useState<Map<number, PairState>>(new Map());
  const pairByEventRef = useRef(pairByEvent);
  useEffect(() => { pairByEventRef.current = pairByEvent; }, [pairByEvent]);
  // Sống qua các lần effect re-run (retry 3s) — CHỈ hủy khi component unmount. Trước đây dùng
  // `alive` per-effect nên retry tick giết fetch đang bay → entry kẹt 'loading' vĩnh viễn.
  const mountedRef = useRef(true);
  // PHẢI set lại true khi mount (dev StrictMode mount→unmount→remount, nếu chỉ set false ở cleanup
  // thì remount kẹt false → mọi fetch đối đầu bị chặn → kẹt "đang tải" toàn bộ).
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Nhịp retry cho trận lỗi tải đối đầu — quét lại đều đặn, đừng để kẹt "Không tải được"/empty.
  const [pairRetryTick, setPairRetryTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) setPairRetryTick((t) => t + 1); }, 3000);
    return () => clearInterval(id);
  }, []);

  // Late-goal (≥40') featured pairs — curated top-10 per half, fetched once on
  // mount (cached route). Lookup maps keyed by normalized pair "A|B" (sorted).
  const [lateGoalH1, setLateGoalH1] = useState<Map<string, { pct: number; pct30: number; n: number }>>(new Map());
  const [lateGoalH2, setLateGoalH2] = useState<Map<string, { pct: number; pct30: number; n: number }>>(new Map());
  // 7+ bàn: số trận lịch sử của cặp có ≥7 bàn (tổng). key "A|B" → count.
  const [high7Map, setHigh7Map] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let alive = true;
    fetch('/api/gs-late-goal-featured')
      .then((r) => r.json())
      .then((json: { h1?: { t1: string; t2: string; pct: number; pct30?: number; n: number; high7?: number }[]; h2?: { t1: string; t2: string; pct: number; pct30?: number; n: number }[] }) => {
        if (!alive) return;
        const toMap = (arr?: { t1: string; t2: string; pct: number; pct30?: number; n: number }[]) =>
          new Map((arr ?? []).map((p) => [[p.t1, p.t2].sort().join('|'), { pct: p.pct, pct30: p.pct30 ?? 0, n: p.n }]));
        setLateGoalH1(toMap(json.h1));
        setLateGoalH2(toMap(json.h2));
        setHigh7Map(new Map((json.h1 ?? []).map((p) => [[p.t1, p.t2].sort().join('|'), p.high7 ?? 0])));
      })
      .catch(() => { /* giữ map rỗng khi lỗi — chỉ ẩn stat, không vỡ trang */ });
    return () => { alive = false; };
  }, []);

  // League priors (calibrated P(Tài) per leagueTag/h1Bucket/market) — mount + mỗi 10'.
  // Fail → giữ map cũ (không phá UI). 1 request full bảng nhỏ, KHÔNG fetch per-match. (§3.4)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/gs-league-priors', { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; priors?: { leagueTag: string; h1Bucket: number; market: string; n: number; pTai: number }[] };
        if (!alive || !json.ok || !json.priors) return;
        const m = new Map<string, { pTai: number; n: number }>();
        for (const p of json.priors) m.set(`${p.leagueTag}:${p.h1Bucket}:${p.market}`, { pTai: p.pTai, n: p.n });
        leaguePriorsRef.current = m;
      } catch { /* giữ map cũ */ }
    };
    load();
    const id = setInterval(load, 600_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // H1 final scores tracked across H1→H2 transition
  const h1FinalRef = useRef<Map<number, { home: number; away: number }>>(new Map());
  const [h1Finals, setH1Finals] = useState<Map<number, { home: number; away: number }>>(new Map());
  const prevRef = useRef<Map<number, GsLiveMatch>>(new Map());

  // Lịch sử ouLine per event (cross-poll, intra-session). Cap 40. Reset khi trận hết live. (§3.1)
  const lineDriftRef = useRef<Map<number, { line: number; scored: number; ts: number; market: 'ft' | 'h1' }[]>>(new Map());
  // League priors từ /api/gs-league-priors, refresh 10'. Key = `${leagueTag}:${h1Bucket}:${market}`. (§3.4)
  const leaguePriorsRef = useRef<Map<string, { pTai: number; n: number }>>(new Map());

  // ── Toasts + OS notifications (mirror of GS Live) ──────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const [scoredIds, setScoredIds] = useState<Set<number>>(new Set());
  const [goalLog, setGoalLog] = useState<GoalEvent[]>([]); // phút ghi bàn (suy từ match_odds_log) của trận đang live
  // Key = danh sách eventId trận live (đổi khi có trận vào/ra) → fetch NGAY, không chờ tick (hết trễ ~6s).
  const liveIdsKey = matches.filter((m) => m.isLive).map((m) => m.eventId).sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!liveIdsKey) { setGoalLog([]); return; }
    let alive = true;
    const fetchGoals = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // tab ẩn → ngừng, tiết kiệm 3G
      try {
        const res = await fetch(`/api/gs-live-goals?events=${liveIdsKey}`, { cache: 'no-store' });
        const json = (await res.json()) as { ok: boolean; goals?: GoalEvent[] };
        if (alive && json.ok) setGoalLog(json.goals ?? []);
      } catch { /* giữ nguyên */ }
    };
    fetchGoals();                       // fetch ngay khi set trận live đổi
    const id = setInterval(fetchGoals, 10000); // sau đó 10s/lần (bàn thắng hiếm → thưa cho nhẹ 3G)
    return () => { alive = false; clearInterval(id); };
  }, [liveIdsKey]);
  const [osNotiGoal, setOsNotiGoal] = useState(false);
  const [osNotiHT, setOsNotiHT] = useState(false);
  const osNotiGoalRef = useRef(false);
  const osNotiHTRef = useRef(false);
  // Toast in-app: bật/tắt popup. Mặc định BẬT (chỉ tắt khi localStorage = '0').
  const [toastOn, setToastOn] = useState(true);
  const toastOnRef = useRef(true);
  // Lọc theo loại trận (16p / 20p / tất cả). Ref để effect noti (poll) đọc giá trị mới nhất.
  const [typeFilter, setTypeFilter] = useState<'all' | '16p' | '20p'>('all');
  const typeFilterRef = useRef<'all' | '16p' | '20p'>('all');

  useEffect(() => {
    const g = localStorage.getItem('gs_os_noti_goal') === '1';
    const h = localStorage.getItem('gs_os_noti_ht') === '1';
    setOsNotiGoal(g); osNotiGoalRef.current = g;
    setOsNotiHT(h);   osNotiHTRef.current = h;
    const t = localStorage.getItem('gs_toast_rank') !== '0';
    setToastOn(t); toastOnRef.current = t;
    const tf = localStorage.getItem('gs_tx_type_filter');
    if (tf === '16p' || tf === '20p' || tf === 'all') { setTypeFilter(tf); typeFilterRef.current = tf; }
  }, []);
  useEffect(() => { osNotiGoalRef.current = osNotiGoal; }, [osNotiGoal]);
  useEffect(() => { osNotiHTRef.current = osNotiHT; }, [osNotiHT]);
  useEffect(() => { toastOnRef.current = toastOn; }, [toastOn]);
  useEffect(() => { typeFilterRef.current = typeFilter; }, [typeFilter]);

  // Kèo có qua bộ lọc loại trận hiện tại không (đọc qua ref để effect noti thấy giá trị mới).
  const passesFilter = (mt: GsLiveMatch['matchType']) =>
    typeFilterRef.current === 'all' || mt === typeFilterRef.current;

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

  // Poll trận live mỗi POLL_MS (5s) — ngừng khi tab ẩn (trừ khi bật noti).
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
          const next = json.matches ?? [];
          // Goal detection vs previous poll → toast + OS noti + green flash
          const newScored = new Set<number>();
          for (const nm of next) {
            const pm = prevRef.current.get(nm.eventId);
            if (!pm) continue;
            const matchTime = `${nm.isH2 ? '2H' : '1H'} ${nm.minuteElapsed ?? 0}'`;
            const notifyThis = passesFilter(nm.matchType); // trận không qua bộ lọc → không noti/toast
            if (nm.h1Home > pm.h1Home) {
              newScored.add(nm.eventId);
              if (notifyThis) {
                pushToast('goal', `⚽ ${nm.homeTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away} · ${matchTime}`);
                notifyOS('goal', `⚽ ${nm.homeTeam} ghi bàn!`, `${nm.homeTeam}  ${nm.h1Home} – ${nm.h1Away}  ${nm.awayTeam}\n${matchTime}`, nm.eventId);
              }
            }
            if (nm.h1Away > pm.h1Away) {
              newScored.add(nm.eventId);
              if (notifyThis) {
                pushToast('goal', `⚽ ${nm.awayTeam} ghi bàn! ${nm.h1Home}-${nm.h1Away} · ${matchTime}`);
                notifyOS('goal', `⚽ ${nm.awayTeam} ghi bàn!`, `${nm.homeTeam}  ${nm.h1Home} – ${nm.h1Away}  ${nm.awayTeam}\n${matchTime}`, nm.eventId);
              }
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
                if (passesFilter(nm.matchType)) { // trận không qua bộ lọc → không noti/toast HT
                  pushToast('halftime', `🔔 Hết Hiệp 1 — ${nm.homeTeam} ${pm.h1Home}–${pm.h1Away} ${nm.awayTeam}`);
                  notifyOS('ht', '🔔 Hết Hiệp 1', `${nm.homeTeam} ${pm.h1Home}–${pm.h1Away} ${nm.awayTeam}`, nm.eventId);
                }
              }
            }
          }
          if (h1Changed) setH1Finals(new Map(h1FinalRef.current));
          prevRef.current = new Map(next.map((m) => [m.eventId, m]));
          setMatches(next);

          // Cập nhật lineDriftRef: push khi line FT/H1 đổi (dedup theo giá trị liền trước, cap 40).
          // Trận hết live → xoá entry để không phình bộ nhớ (mirror xiuSeen reset).
          for (const nm of next) {
            if (!nm.isLive) {
              lineDriftRef.current.delete(nm.eventId);
              continue;
            }
            const pushSnap = (market: 'ft' | 'h1', rawLine: string | null | undefined) => {
              const parsed = parseLine(rawLine);
              if (!parsed) return;
              const lineVal = parsed.lineVal;
              const arr = lineDriftRef.current.get(nm.eventId) ?? [];
              // Dedup theo snapshot CÙNG market gần nhất (ft/h1 xen kẽ nên at(-1) có thể khác market).
              const lastSame = [...arr].reverse().find((h) => h.market === market);
              if (lastSame && lastSame.line === lineVal) return;
              arr.push({ line: lineVal, scored: nm.h1Home + nm.h1Away, ts: Date.now(), market });
              lineDriftRef.current.set(nm.eventId, arr.slice(-40));
            };
            pushSnap('ft', nm.ouLines?.[0]?.line);
            pushSnap('h1', nm.ouH1Lines?.[0]?.line);
          }
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    }

    poll();
    // Poll 10s/lần (giảm tải call /api/gs-live).
    const POLL_MS = 5_000;
    const id = setInterval(poll, POLL_MS);
    const onVis = () => { if (!document.hidden) poll(); }; // quay lại tab → refresh ngay
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // H2H splits — keyed by stable pair set, refresh every 5 min.
  // 4G: CHỈ tải mức đang chọn (không prefetch cả 20/50/100). Đổi filter → effect chạy lại tải mức mới (lazy).
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
    // Tải mức đang chọn (effect chạy lại khi pairsKey/h2hLimit đổi → luôn khớp trận hiện tại). Ngừng khi tab ẩn.
    const loadSel = () => { if (typeof document !== 'undefined' && document.hidden) return; loadOne(h2hLimit); };
    loadSel();
    const id = setInterval(loadSel, 300_000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // KHÔNG cleanup hủy fetch: dùng mountedRef nên fetch sống qua các lần retry re-run (không kẹt 'loading').
    // Chỉ set 'loading' cho cái CHƯA có (giữ text lỗi khi retry 'error', không nháy spinner).
    const fresh = toFetch.filter((id) => !pairByEventRef.current.has(id));
    if (fresh.length > 0) {
      setPairByEvent((prev) => {
        const next = new Map(prev);
        for (const id of fresh) next.set(id, { status: 'loading' });
        return next;
      });
    }
    for (const id of toFetch) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000); // treo >12s → abort → 'error' → retry nhịp sau
      fetch(`/api/gs-h2h-pair?eventId=${id}`, { cache: 'no-store', signal: ctrl.signal })
        .then(async (r) => {
          clearTimeout(to);
          const json = (await r.json()) as { ok: boolean } & Partial<H2HPair>;
          if (!mountedRef.current) return;
          setPairByEvent((prev) => {
            const next = new Map(prev);
            next.set(id, json.ok
              ? { status: 'ready', ft: json.ft ?? null, h1: json.h1 ?? null, h1Totals: json.h1Totals ?? [], ftTotals: json.ftTotals ?? [], matches: json.matches ?? [] }
              : { status: 'error' });
            return next;
          });
        })
        .catch(() => {
          clearTimeout(to);
          if (!mountedRef.current) return;
          setPairByEvent((prev) => new Map(prev).set(id, { status: 'error' }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEventIdsKey, pairRetryTick]);

  // Render theo THỨ TỰ FEED gốc (liveMatches = như nhà cái trả về), KHÔNG sort eventId
  // (sorted chỉ dùng cho fetch-key ổn định). → thứ tự hiển thị khớp nhà cái.
  // Lọc theo loại trận (16p/20p/tất cả) trước khi render danh sách.
  const shownMatches = liveMatches.filter((m) => typeFilter === 'all' || m.matchType === typeFilter);
  const group16 = shownMatches.filter((m) => m.leagueId === LEAGUE_16P);
  const group20 = shownMatches.filter((m) => m.leagueId === LEAGUE_20P);

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
    // Hiệp đang diễn ra → box tương ứng. HT (period 4, nghỉ giữa hiệp) → coi như đã sang H2/FT
    // (H1 đã xong, không hiện box H1 nữa mà hiện H2/FT chuẩn bị hiệp 2).
    const activeHalf = isHT ? 'h2' : phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'h2' : null;
    const activeMarket = isHT ? 'ft' : phase.big === 'H1' ? 'h1' : phase.big === 'H2' ? 'ft' : null;
    // H2H theo hiệp: LUÔN hiện cả 2 box (H2 + H1) ở vị trí cố định, bất kể phase —
    // không collapse còn 1 box khi sang H2 (tránh layout nhảy/lệch). Ở H2, box H1
    // vẫn hiện % đối đầu H1 (sp.h1); cột odds/Tài-Xỉu H1 tự về "—" vì market đã đóng.
    const sp = h2hMap.get(`${m.homeTeam}|${m.awayTeam}`);
    const meetings = sp?.meetings ?? 0;
    // Late-goal (≥40') featured stat — chỉ hiện nếu cặp nằm trong top-10 (H1/H2).
    const lgKey = [m.homeTeam, m.awayTeam].sort().join('|');
    const lgH1 = lateGoalH1.get(lgKey);
    const lgH2 = lateGoalH2.get(lgKey);
    const halves = sp && meetings > 0
      ? [{ key: 'h2', label: 'Tỉ lệ Thắng Hiệp 2', s: sp.h2 }, { key: 'h1', label: 'Tỉ lệ Thắng H1', s: sp.h1 }]
      : [];
    const boxClass = `rounded-lg border p-3 w-full min-w-0 h-full transition-all ${
      scored
        ? 'border-[#22c55e]/60 !bg-[#16a34a]/15'
        : isHT
        ? 'border-amber-500/50 bg-amber-900/10'
        : 'border-[#2a2a2a] bg-[#141414]'
    }`;
    // Nhà cái KHOÁ kèo trận NÀY (per-match): đóng cược hoặc kèo O/U bị suspend.
    const locked = !!m.isLive && (m.bettingOpen === false || m.ouLines?.[0]?.suspended || m.ouH1Lines?.[0]?.suspended);
    // ── Layout "Gọn Tài/Xỉu": ẩn cột 1X2, xếp dọc (dòng 1 đội+tỉ số+phase, dòng 2 hai box hiệp) ──
    return (
      <div
        data-event-id={m.eventId}
        className={`${boxClass} relative flex flex-col gap-2`}
      >
          {/* Khoá kèo: phủ mờ CẢ box + ổ khoá nổi lên — chỉ trận này, biết là ko vào lệnh được */}
          {locked && (
            <>
              <div className="pointer-events-none absolute inset-0 z-10 rounded-lg bg-[#0d0d0d]/60" />
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <div className="flex items-center gap-1.5 rounded-md border border-[#fbbf24]/50 bg-black/80 px-3 py-1.5 text-[12px] font-semibold text-[#fbbf24] shadow-lg">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Nhà cái khoá kèo
                </div>
              </div>
            </>
          )}
          {/* Dòng 1: tên đội + tỉ số (trái) · phase (phải) */}
          <div className="flex items-center justify-between gap-2 md:gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2 md:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] md:text-[14px] font-semibold leading-tight">
                  <span className="truncate text-[#4ade80]">{m.homeTeam}</span>
                  <RedCardBadge n={m.redHome} />
                  <span className="shrink-0 font-normal text-[#888]">vs</span>
                  <span className="truncate text-[#fb7185]">{m.awayTeam}</span>
                  <RedCardBadge n={m.redAway} />
                  {/* 7+ bàn: số trận lịch sử của cặp có ≥7 bàn — chỉ hiện khi >0. */}
                  {(high7Map.get(lgKey) ?? 0) > 0 && (
                    <span
                      className="shrink-0 rounded bg-[#f97316]/20 px-1.5 py-0.5 text-[10px] md:text-[11px] font-bold tabular-nums text-[#fdba74]"
                      title="Số trận lịch sử đối đầu có ≥7 bàn thắng"
                    >
                      7+ n={high7Map.get(lgKey)}
                    </span>
                  )}
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
              {/* Nút mở drawer chi tiết đối đầu — thay cho click cả card. */}
              <button
                type="button"
                onClick={() => setSelected(m)}
                title="Xem chi tiết đối đầu"
                aria-label="Xem chi tiết đối đầu"
                className="mt-1.5 inline-flex items-center justify-center rounded-full border border-[#38bdf8]/50 bg-[#38bdf8]/15 p-1 text-[#7dd3fc] shadow-sm transition-all hover:scale-110 hover:bg-[#38bdf8]/30 active:scale-95"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 md:h-3.5 md:w-3.5">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            </div>
          </div>
          {/* Bố cục 2 cột: TRÁI = Bàn muộn (trên) + Tỉ lệ thắng (dưới, giãn cao) · PHẢI = Chỉ số TB (giãn cao).
              items-stretch để 2 cột cùng chiều cao (cột phải cao nhất → box tỉ-lệ trái stretch theo). */}
          <div className="flex items-stretch gap-2 md:gap-2.5">
            {/* CỘT TRÁI: Bàn muộn + Tỉ lệ thắng */}
            <div className="flex min-w-0 flex-1 flex-col gap-2 md:gap-2.5">
              {/* Bàn muộn ≥30′ + ≥40′ — CHỈ hiện hiệp ĐANG đá (giảm info), full-width, highlight xanh. */}
              {(() => {
                const showH2 = m.isH2 || isHT;
                const lg = showH2 ? lgH2 : lgH1;
                if (!lg) return null;
                // % nổi bật theo mức: cao→xanh, vừa→vàng, thấp→đỏ (đèn giao thông).
                const colorFor = (p: number) => (p >= 45 ? '#4ade80' : p >= 35 ? '#fbbf24' : '#f87171');
                return (
                  <div className="flex w-full items-stretch rounded-md border border-[#38bdf8]/50 bg-[#38bdf8]/15 text-[#bae6fd]">
                    {/* Cột TRÁI: cụm ≥30′/≥40′ gọn, căn giữa — nhãn phải · % trái (grid 2×2) */}
                    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[#7dd3fc] opacity-80">Tỉ lệ ghi thêm bàn</span>
                      <div className="grid grid-cols-[auto_auto] items-baseline gap-x-2.5 gap-y-1 tabular-nums">
                        <span className="justify-self-end text-[11px] md:text-[12px] font-semibold opacity-60">≥30′</span>
                        <span className="justify-self-start text-[20px] md:text-[23px] font-extrabold leading-none" style={{ color: colorFor(lg.pct30) }}>{lg.pct30}%</span>
                        <span className="justify-self-end text-[11px] md:text-[12px] font-semibold opacity-60">≥40′</span>
                        <span className="justify-self-start text-[20px] md:text-[23px] font-extrabold leading-none" style={{ color: colorFor(lg.pct) }}>{lg.pct}%</span>
                      </div>
                    </div>
                    {/* Cột PHẢI: n (căn giữa, vạch ngăn, độ rộng cố định) */}
                    <div className="flex w-[54px] md:w-[60px] shrink-0 items-center justify-center border-l border-[#38bdf8]/30 text-center">
                      <span className="text-[12px] md:text-[13px] font-medium tabular-nums opacity-70">n={lg.n}</span>
                    </div>
                  </div>
                );
              })()}
              {/* TỈ LỆ THẮNG: 1 box (hiệp đang đá) + %đối đầu — giãn cao (flex-1) để khớp cột phải. */}
              {halves.length === 0 ? (
                <span className="flex flex-1 items-center text-[11px] text-[#555]">ĐĐ —</span>
              ) : (
                halves.filter((h) => h.key === activeHalf || activeHalf === null).map((h) => {
                  const active = h.key === activeHalf;
                  return (
                    <div
                      key={h.key}
                      className={`flex flex-1 min-w-0 flex-col items-center justify-center rounded-md border px-2 py-1.5 md:px-3 ${
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
            {/* CỘT PHẢI: Chỉ số TB (FT/H1) — giãn cao đầy cột. */}
            <div className="flex min-w-0 flex-1">
              <PairH2HRow eventId={m.eventId} activeMarket={activeMarket} ftLine={m.ouLines?.[0]?.line} h1Line={m.ouH1Lines?.[0]?.line} />
            </div>
          </div>
          {/* Dòng gợi ý Tài/Xỉu deterministic — TẠM ẨN UI (2026-07-27) theo yêu cầu.
              Kèo VẪN bắn Telegram bình thường qua bot VPS tx-paper-bot.mjs (độc lập FE).
              Bật lại = bỏ comment dòng dưới. */}
          {false && <TxSuggestionRow m={m} activeMarket={activeMarket} />}
          {/* OU line LIVE của trận này — chèn GIỮA cụm box thống kê và list 10 trận.
              2 box: TRÁI = Hiệp 1 (m.ouH1Lines), PHẢI = Hiệp 2/cả trận (m.ouLines).
              Mỗi box 2 line = 2 kèo Tài (over) + 2 kèo Xỉu (under). */}
          <div className="mt-1.5 border-t border-[#222] pt-1.5">
            <div className="mb-1 text-[9px] md:text-[10px] uppercase tracking-wide text-[#666]">📊 OU line (live)</div>
            <div className="flex gap-1.5 md:gap-2">
              <OuLiveBox title="🕐 Hiệp 1" lines={m.ouH1Lines} active={activeMarket === 'h1'} />
              <OuLiveBox title="⚽ Hiệp 2 / cả trận" lines={m.ouLines} active={activeMarket === 'ft'} />
            </div>
          </div>
          {/* Timeline GHI BÀN của trận này (suy từ match_odds_log) — thanh H1|H2, mốc bàn theo phút. */}
          {(() => {
            const goals = goalLog.filter((g) => g.e === m.eventId);
            if (goals.length === 0) return null;
            const HOME = '#38bdf8', AWAY = '#fb7185';   // nhà = cyan, khách = hồng
            const HALF_MAX = 45;                        // phút mô phỏng mỗi hiệp ~0-45
            const posOf = (g: GoalEvent) => {
              const mm = Math.min(Math.max(g.m, 0), HALF_MAX);
              return g.h2 ? 50 + (mm / HALF_MAX) * 50 : (mm / HALF_MAX) * 50;
            };
            return (
              <div className="mt-1.5 border-t border-[#222] pt-1.5">
                <div className="mb-1 flex items-center gap-2 text-[9px] md:text-[10px] uppercase tracking-wide text-[#666]">
                  <span>⚽ Timeline ghi bàn ({goals.length})</span>
                  <span className="ml-auto flex items-center gap-2 normal-case tracking-normal text-[9px]">
                    <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: HOME }} /><span className="max-w-[70px] truncate" style={{ color: HOME }}>{m.homeTeam}</span></span>
                    <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: AWAY }} /><span className="max-w-[70px] truncate" style={{ color: AWAY }}>{m.awayTeam}</span></span>
                  </span>
                </div>
                <div className="relative h-10 rounded border border-[#242424] bg-[#161616]">
                  {/* nền H1 / H2 + vạch HT */}
                  <div className="absolute inset-y-0 left-0 w-1/2 rounded-l bg-[#fbbf24]/[.04]" />
                  <div className="absolute inset-y-0 right-0 w-1/2 rounded-r bg-[#4ade80]/[.04]" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[#3a3a3a]" />
                  <span className="absolute left-1 top-0.5 text-[8px] font-semibold text-[#fbbf24]/70">H1</span>
                  <span className="absolute right-1 top-0.5 text-[8px] font-semibold text-[#4ade80]/70">H2</span>
                  {goals.map((g, i) => {
                    const left = posOf(g);
                    const color = g.s === 'h' ? HOME : AWAY;
                    const team = g.s === 'h' ? m.homeTeam : m.awayTeam;
                    return (
                      <div key={`${g.s}-${g.h2 ? 'H2' : 'H1'}-${g.m}-${g.sh}-${g.sa}-${i}`}
                        className="absolute inset-y-0" style={{ left: `${left}%` }}
                        title={`${team} ghi phút ${g.m}' (${g.h2 ? 'H2' : 'H1'}) — ${g.sh}-${g.sa}`}>
                        <div className="absolute inset-y-1.5 w-px" style={{ background: color, opacity: 0.4, transform: 'translateX(-0.5px)' }} />
                        <div className="absolute left-0 top-1/2 h-[9px] w-[9px] rounded-full" style={{ background: color, transform: 'translate(-50%,-50%)', boxShadow: '0 0 0 2px #161616' }} />
                        <span className="absolute left-0 -top-0.5 text-[8px] font-bold tabular-nums" style={{ color, transform: 'translateX(-50%)' }}>{g.m}&apos;</span>
                        <span className="absolute left-0 bottom-0 text-[7px] tabular-nums text-white/45" style={{ transform: 'translateX(-50%)' }}>{g.sh}-{g.sa}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {/* 10 trận đối đầu gần nhất — H1 đang đá → score H1; H2/HT → score FT. */}
          <H2HMiniList eventId={m.eventId} showH2={m.isH2 || isHT} />
        </div>
      );
  }

  // Dòng 2 của Kiểu 'h2h': 2 box FT + H1 (cùng khung box gọn như Kiểu 'live').
  // Trong lúc chờ /api/gs-h2h-pair → spinner per-box; lỗi → "—"; sẵn → Tài%/Xỉu%.
  function PairStatBox({ label, title, stat, active, line }: { label: string; title?: string; stat: H2HPairStat | null; active?: boolean; line?: string | null }) {
    return (
      <div
        className={`flex flex-1 min-w-0 flex-col items-center justify-center rounded-md border px-2 py-1.5 md:px-3 ${
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

  // 10 trận đối đầu gần nhất — mang từ drawer ra list: 2 tên đội + H1 + FT score.
  // 2 cột × 5 trận (mobile + web). Đọc trực tiếp pairByEvent (đã fetch per-card).
  function H2HMiniList({ eventId, showH2 }: { eventId: number; showH2: boolean }) {
    const st = pairByEvent.get(eventId);
    if (!st || st.status !== 'ready' || !st.matches?.length) return null;
    void showH2; // giờ hiện CẢ HT + FT, không toggle nữa
    const rows = st.matches.slice(0, 10);
    const stripTag = (s: string) => s.replace(/\s*\([VS]\)\s*$/, '');
    // Hiện CẢ HT (hiệp 1, vàng) và FT (cả trận, trắng) — data từ gs_matches_history (htScore/ftScore).
    const Col = ({ items }: { items: H2HPairMatch[] }) => (
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {items.map((mt, i) => (
          <div key={i} className="flex items-center justify-between gap-1.5 rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] md:text-[11px] leading-tight">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[#4ade80]">{stripTag(mt.home)}</span>
              <span className="text-[#666]"> v </span>
              <span className="text-[#fb7185]">{stripTag(mt.away)}</span>
            </span>
            <span className="shrink-0 tabular-nums font-extrabold text-[12px] md:text-[14px] leading-none">
              <span style={{ color: '#fbbf24' }} title="Hiệp 1 (HT)">{mt.htScore}</span>
              <span className="mx-0.5 text-[#555]">/</span>
              <span style={{ color: '#e5e7eb' }} title="Cả trận (FT)">{mt.ftScore}</span>
            </span>
          </div>
        ))}
      </div>
    );
    return (
      <div className="mt-1.5 border-t border-[#222] pt-1.5">
        <div className="mb-1 flex items-center gap-1.5 text-[9px] md:text-[10px] uppercase tracking-wide text-[#666]">
          <span>10 trận gần nhất</span>
          <span className="text-[#444]">·</span>
          <span><span style={{ color: '#fbbf24' }}>HT</span> <span className="text-[#555]">/</span> <span style={{ color: '#e5e7eb' }}>FT</span></span>
        </div>
        <div className="flex gap-1.5 md:gap-2">
          <Col items={rows.slice(0, 5)} />
          <Col items={rows.slice(5, 10)} />
        </div>
      </div>
    );
  }

  function PairH2HRow({ eventId, activeMarket, ftLine, h1Line }: { eventId: number; activeMarket: 'ft' | 'h1' | null; ftLine?: string | null; h1Line?: string | null }) {
    const st = pairByEvent.get(eventId);
    if (!st || st.status === 'loading') {
      return (
        <div className="flex min-h-[64px] w-full flex-1 items-center justify-center gap-2 rounded-md border border-[#2a2a2a] bg-[#1c1c1c] py-3 text-[11px] text-[#17a2b8]">
          <Spinner size={13} /> Đang tải đối đầu…
        </div>
      );
    }
    if (st.status === 'error') {
      return (
        <div className="flex min-h-[64px] w-full flex-1 items-center justify-center rounded-md border border-[#2a2a2a] bg-[#1c1c1c] py-3 text-[11px] text-[#777]">
          Không tải được đối đầu
        </div>
      );
    }
    // CHỈ hiện box của market ĐANG đá (giảm info): H1 → box H1; H2 → box FT. Null → cả 2.
    return (
      <div className="flex w-full flex-1 gap-2.5">
        {activeMarket !== 'h1' && (
          <PairStatBox label="FT" title="Chỉ số TB Tài Xỉu FT" stat={st.ft} active={activeMarket === 'ft'} line={ftLine} />
        )}
        {activeMarket !== 'ft' && (
          <PairStatBox label="H1" title="Chỉ số TB Tài Xỉu H1" stat={st.h1} active={activeMarket === 'h1'} line={h1Line} />
        )}
      </div>
    );
  }

  // Dòng gợi ý Tài/Xỉu (EMPIRICAL, deterministic). Tính INLINE mỗi render 2s từ tỉ số +
  // phân phối tổng bàn ĐĐ HIỆN TẠI → có bàn vào là verdict tự đổi (không memo, không cache theo eventId).
  function TxSuggestionRow({ m, activeMarket }: { m: GsLiveMatch; activeMarket: 'ft' | 'h1' | null }) {
    // Placeholder mờ để MỌI trận đều có dòng (bật tất cả các trận) — không ẩn hẳn.
    const phBox = 'mt-1 flex items-center justify-center text-[11px] font-normal text-[#4b5563]';
    const ph = (text: string) => <div className={phBox}>{text}</div>;
    // Không live / chưa vào hiệp (HT/Chờ/KT) → chưa có kèo để gợi ý.
    if (!m.isLive || activeMarket === null) {
      xiuSeen.delete(`${m.eventId}:h1`); // trận hết live → reset bộ đếm gãy Xỉu
      xiuSeen.delete(`${m.eventId}:ft`);
      return ph('⏸ chưa vào kèo');
    }
    // Nhà cái KHOÁ kèo Tài/Xỉu (suspend) hoặc đóng cược → KHÔNG suggest (suggest mà không vào được = vô nghĩa).
    const ouSel = activeMarket === 'h1' ? m.ouH1Lines?.[0] : m.ouLines?.[0];
    if (m.bettingOpen === false || ouSel?.suspended) return ph('🔒 nhà cái khoá kèo');
    const st = pairByEvent.get(m.eventId);
    if (!st || st.status !== 'ready') return ph('⏳ đang tải đối đầu…');

    const lowConf = false; // H2 giờ dùng thẳng kèo TOÀN TRẬN (không còn "ước lượng FT−H1")
    const tip: string | undefined = undefined;
    const approx = '';
    const container = 'mt-1 flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 text-[13px] md:text-[14px] font-semibold tabular-nums';
    // Lệch quy luật (phá trần lịch sử): màu xám-vàng cảnh báo, KHÔNG ra kèo (§4.4).
    const breakRow = (scope: 'h1' | 'h2') => (
      <div className={container} title={scope === 'h2' ? 'H1 phá trần lịch sử → phân phối H2 hết đại diện' : 'Tỉ số H1 vượt mọi trận đối đầu → phân phối hết đại diện'} style={{ color: '#d4a72c' }}>
        <span className="font-normal">{approx}⚠ lệch quy luật{scope === 'h2' ? ' (H1 phá trần)' : ''}</span>
      </div>
    );

    // CHỈ lấy 10 trận đối đầu GẦN NHẤT để thống kê (totals xếp mới→cũ → slice đầu mảng).
    const h1Totals = st.h1Totals.slice(0, RECENT_N);
    const ftTotals = st.ftTotals.slice(0, RECENT_N);
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
      // H2: dùng thẳng kèo TOÀN TRẬN (ftTotals + line FT thật + tổng hiện tại) — trực quan, KHÔNG cần h1Final.
      if (ftTotals.length < N_MIN) return ph(`— chưa đủ đối đầu (n<${N_MIN})`);
      // §5 GUARD phá trần H2 (đối xứng H1): tổng cả trận vượt max lịch sử FT nhưng CHƯA tới line FT
      // → lệch quy luật, KHÔNG ra kèo. Nếu đã vượt line (scored>line) → computeSignal override, guard nhường.
      const lineFt = parseLine(m.ouLines?.[0]?.line)?.lineVal;
      if (scoredNow > h1Ceiling(ftTotals) && !(lineFt != null && scoredNow > lineFt)) {
        return breakRow('h2');
      }
      totals = ftTotals;
      scored = scoredNow;                     // tổng bàn CẢ TRẬN hiện tại (line FT không trừ gì)
      lineRaw = m.ouLines?.[0]?.line;
      overRaw = m.ouLines?.[0]?.over;
      underRaw = m.ouLines?.[0]?.under;
    }

    // League tag drives direction (v6.0): (V)→Tài, (S)→Xỉu, untagged→model.
    const isS = m.homeTeam.includes('(S)');
    const isV = m.homeTeam.includes('(V)');
    // leagueTag khớp route (§4): `${matchType}${:S|:V|''}`. Bucket theo tổng bàn H1 hiện tại.
    const variant = isS ? ':S' : isV ? ':V' : '';
    const priorKey = `${m.matchType}${variant}:${h1Bucket(m.h1Home + m.h1Away)}:${activeMarket}`;
    const sig = computeSignal({
      totals, lowConf, scored, lineRaw, overRaw, underRaw, isS, isV,
      lineDriftHistory: (lineDriftRef.current.get(m.eventId) ?? [])
        .filter((h) => h.market === activeMarket)
        .map(({ line, scored: s, ts }) => ({ line, scored: s, ts })),
      // Tempo chỉ áp H1 (§3.2 #3): corners/cards ở GS Ảo là tally H1-heavy.
      cornersTotal: activeMarket === 'h1' ? m.cornersHome + m.cornersAway : undefined,
      cardsWeighted: activeMarket === 'h1' ? m.yellowHome + m.yellowAway + 3 * (m.redHome + m.redAway) : undefined,
      leaguePrior: leaguePriorsRef.current.get(priorKey) ?? null,
    });
    if (!sig) return ph('— chưa có line kèo'); // thiếu line/giá → placeholder (KHÔNG show VÀO khi thiếu số liệu)

    // REALTIME thuần: mỗi poll hiện verdict hiện tại (có bàn/đổi số là verdict tự đổi). KHÔNG khóa, không lưu.
    if (sig.kind === 'vao') {
      const tai = sig.side === 'tai';
      // TX v7 pocket gate (mirror tx-paper-bot.mjs allowed block — lọc theo phân tích 397 kèo):
      //   TÀI: chỉ h1 · line ≤0.75 · phút ≤25 (pocket +EV bền duy nhất). XỈU: giữ, loại ổ h1 line=0.75 (0/10, −7u).
      const sigLineNum = Number(sig.line);
      let allowed: boolean;
      if (tai) {
        const min = m.minuteElapsed;
        allowed = activeMarket === 'h1' && sigLineNum <= 0.75 + 1e-9 && min != null && min <= 25;
      } else {
        allowed = !(activeMarket === 'h1' && Math.abs(sigLineNum - 0.75) < 1e-9);
      }
      if (!allowed) return ph('— chưa đủ điều kiện vào (v7)');
      // DCA Xỉu: đã gãy ≥2 line Under trong hiệp này → dừng, không gợi ý Xỉu lần 3.
      if (!tai) {
        const key = `${m.eventId}:${activeMarket}`;
        const seenLines = xiuSeen.get(key) ?? [];
        const lv = parseLine(lineRaw)?.lineVal;
        // Xỉu chỉ vào 1 lần/hiệp: đã hiện 1 line Xỉu rồi mà line đổi (bóng vào, line chạy) → KHÔNG vào thêm.
        if (seenLines.length > 0 && !seenLines.includes(lv ?? NaN)) return ph('🛑 đã vào Xỉu hiệp này — không vào thêm');
        if (seenLines.length === 0 && lv != null) xiuSeen.set(key, [lv]);
      }
      return (
        <div className={`${container} tx-pending rounded-lg px-2.5 py-1`} title={tip} style={{ color: tai ? '#4ade80' : '#fb7185' }}>
          <span>{approx}⚡ VÀO {tai ? 'TÀI' : 'XỈU'} · giá <span className="text-[17px] md:text-[19px] font-extrabold">{Number(sig.price).toFixed(2)}</span></span>
          <span className="text-[13px] md:text-[14px] font-normal text-[#9aa4b2]">(P~{Math.round(sig.pct * 100)}% · line {sig.line})</span>
        </div>
      );
    }

    if (sig.kind === 'cho') {
      const tai = sig.side === 'tai';
      if (sig.waitLine != null) {
        // Chờ line Tài tụt về ngưỡng an toàn (đỡ rủi ro).
        return (
          <div className={container} title={tip} style={{ color: '#9ca3af' }}>
            <span>{approx}⏳ Chờ {tai ? 'Tài' : 'Xỉu'} — đợi còn cần ≤<span className="text-[15px] md:text-[16px] font-bold text-[#cbd5e1]">{sig.waitLine}</span> bàn (đỡ rủi ro)</span>
            <span className="text-[13px] md:text-[14px] font-normal text-[#9aa4b2]">(P~{Math.round(sig.pct * 100)}%)</span>
          </div>
        );
      }
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
        {/* Lọc loại trận: Tất cả / 16p / 20p — lọc cả danh sách hiển thị lẫn noti/toast. */}
        <div className="flex items-center gap-1">
          {([['all', 'Tất cả'], ['16p', '16p'], ['20p', '20p']] as const).map(([val, label]) => {
            const active = typeFilter === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setTypeFilter(val); typeFilterRef.current = val;
                  localStorage.setItem('gs_tx_type_filter', val);
                }}
                className={`rounded px-2 py-0.5 text-[11px] border transition-colors ${active ? 'border-[#38bdf8]/40 text-[#3dd6ea] bg-[#17a2b8]/10 hover:bg-[#17a2b8]/20' : 'border-[#2a2a2a] bg-[#1a1a1a] text-[#aaa] hover:text-white hover:border-[#444]'}`}
                title={`Lọc trận ${label}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-3 py-2 text-[13px] text-[#f87171]">
          {error}
        </div>
      )}

      {group16.length === 0 && group20.length === 0 ? (
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
