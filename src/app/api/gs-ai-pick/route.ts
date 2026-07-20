import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// GS_AI_MODEL overrides; fallback to Haiku (cheap, fast — dùng cho tab thử nghiệm).
const AI_MODEL = process.env.GS_AI_MODEL || 'claude-haiku-4-5';

let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// Bảng cache kèo AI: mỗi trận chỉ gọi Claude 1 lần, lần sau GET lại. Tạo idempotent, 1 lần / process.
// Self-healing: CREATE TABLE IF NOT EXISTS là no-op nếu bảng đã tồn tại (bản deploy cũ có thể thiếu cột),
// nên chạy thêm ALTER TABLE ... ADD COLUMN IF NOT EXISTS cho MỌI cột code SELECT/INSERT — kể cả khi bảng cũ.
let _schemaReady: Promise<void> | null = null;
async function migrateSchema(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS gs_ai_picks (
       event_id    bigint PRIMARY KEY,
       side        text,
       pick        text,
       confidence  text,
       reasoning   text,
       red_flags   jsonb,
       model       text,
       created_at  timestamptz DEFAULT now()
     )`,
  );
  // Idempotent: bù cột còn thiếu nếu bảng được tạo từ bản deploy cũ (schema drift).
  // event_id là PRIMARY KEY nên đã tồn tại từ CREATE TABLE — chỉ cần bù các cột dữ liệu.
  await pool.query(
    `ALTER TABLE gs_ai_picks
       ADD COLUMN IF NOT EXISTS side          text,
       ADD COLUMN IF NOT EXISTS pick          text,
       ADD COLUMN IF NOT EXISTS confidence    text,
       ADD COLUMN IF NOT EXISTS reasoning     text,
       ADD COLUMN IF NOT EXISTS red_flags     jsonb,
       ADD COLUMN IF NOT EXISTS model         text,
       ADD COLUMN IF NOT EXISTS hc_side           text,
       ADD COLUMN IF NOT EXISTS hc_pick           text,
       ADD COLUMN IF NOT EXISTS hc_confidence     text,
       ADD COLUMN IF NOT EXISTS hc_reasoning      text,
       ADD COLUMN IF NOT EXISTS predicted_ft      text,
       ADD COLUMN IF NOT EXISTS story             text,
       ADD COLUMN IF NOT EXISTS which_scores_more text,
       ADD COLUMN IF NOT EXISTS created_at        timestamptz DEFAULT now()`,
  );
}
function ensureSchema(pool: Pool): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = migrateSchema(pool).catch((e) => {
      _schemaReady = null; // cho phép thử lại lần sau nếu migrate lỗi tạm thời
      throw e;
    });
  }
  return _schemaReady;
}

interface CacheRow {
  side: string | null; pick: string | null; confidence: string | null;
  reasoning: string | null; red_flags: unknown; model: string | null;
  hc_side: string | null; hc_pick: string | null;
  hc_confidence: string | null; hc_reasoning: string | null;
  predicted_ft: string | null; story: string | null;
  which_scores_more: string | null;
}

function normFlags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

// ── Row shapes ─────────────────────────────────────────────────────────────────

interface OddsRow {
  home_team: string; away_team: string;
  home_team_id: number | null; away_team_id: number | null;
  score_home: number | null; score_away: number | null;
  hc_line: string | null; hc_home_gives: boolean | null;
  hc_home_odds: string | null; hc_away_odds: string | null;
  ou_line: string | null; ou_over: string | null; ou_under: string | null;
}

interface StatsRow { [k: string]: unknown }

interface ProfileRow {
  avg_tt: string | null; avg_h1: string | null; avg_h2: string | null;
  gf_per_match: string | null; ga_per_match: string | null;
  pct_h2_scored: string | null; win_pct: string | null;
  tier: string | null; tier_z: string | null; matches_n: number | null;
}

interface PairRow { meetings: number | null; avg_total: string | null; cv: string | null; }

interface HistRow {
  h1_home: number | null; h1_away: number | null;
  tt_home: number | null; tt_away: number | null;
  home_team_id: number | null; match_type: string | null;
}

// 20 trận đối đầu gần nhất — kèm ngày, để làm mẫu "cặp này đẻ ra tỉ số cỡ nào".
interface Hist20Row {
  match_time: string | null;
  h1_home: number | null; h1_away: number | null;
  tt_home: number | null; tt_away: number | null;
  home_team_id: number | null;
}

function n(v: unknown): string {
  return v == null ? '?' : String(v);
}

// latest kickoff_h2 snapshot (period=8) for line + HT score, fallback to any snapshot.
async function loadEvent(pool: Pool, eventId: number): Promise<OddsRow | null> {
  const cols = `home_team, away_team, home_team_id, away_team_id, score_home, score_away,
                hc_line, hc_home_gives, hc_home_odds, hc_away_odds, ou_line, ou_over, ou_under`;
  const { rows } = await pool.query<OddsRow>(
    `SELECT ${cols} FROM match_odds_log WHERE event_id=$1 AND period=8 ORDER BY id DESC LIMIT 1`,
    [eventId],
  );
  if (rows.length) return rows[0];
  const { rows: any2 } = await pool.query<OddsRow>(
    `SELECT ${cols} FROM match_odds_log WHERE event_id=$1 ORDER BY id DESC LIMIT 1`,
    [eventId],
  );
  return any2[0] ?? null;
}

function statsBlock(s: StatsRow | null): string {
  if (!s) return '(không đọc được chỉ số Hiệp 1)';
  const pair = (label: string, h: string, a: string) => `${label}: ${n(s[h])}/${n(s[a])}`;
  return [
    pair('SOT (sút trúng đích) — NEO', 'home_sot', 'away_sot'),
    pair('Shots (tổng sút)', 'home_shots', 'away_shots'),
    pair('Shot accuracy %', 'home_shot_acc', 'away_shot_acc'),
    pair('xG', 'home_xg', 'away_xg'),
    pair('Corners (phạt góc)', 'home_corners', 'away_corners'),
    pair('Penalties', 'home_penalties', 'away_penalties'),
    pair('Tackles won', 'home_tackles_won', 'away_tackles_won'),
    pair('Tackles (tổng)', 'home_tackles', 'away_tackles'),
    pair('Saves (cản phá thủ môn)', 'home_saves', 'away_saves'),
  ].map((l) => `  • ${l} (home/away)`).join('\n');
}

function profileBlock(label: string, p: ProfileRow | null): string {
  if (!p) return `${label}: (chưa có hồ sơ)`;
  return `${label}: avg_tt ${n(p.avg_tt)} (bàn TB toàn trận), avg_h2 ${n(p.avg_h2)}, `
    + `gf ${n(p.gf_per_match)}, ga ${n(p.ga_per_match)}, win% ${n(p.win_pct)}, `
    + `tier ${n(p.tier)} (tier_z ${n(p.tier_z)}); mẫu ${n(p.matches_n)}`;
}

function pairBlock(p: PairRow | null): string {
  if (!p) return '  • (chưa có dữ liệu cặp đội)';
  return `  • Số lần gặp: ${n(p.meetings)} · avg_total (TRẦN tổng bàn) ${n(p.avg_total)} · cv ${n(p.cv)}`;
}

// H2H: ai thắng HT vs FT, HT-leader có giữ tới FT không.
function histBlock(rows: HistRow[], homeId: number | null, awayId: number | null): string {
  if (!rows.length) return '  • (chưa có lịch sử đối đầu)';
  return rows.map((r) => {
    const h1h = r.h1_home ?? 0, h1a = r.h1_away ?? 0;
    const tth = r.tt_home ?? 0, tta = r.tt_away ?? 0;
    // home_team_id trong lịch sử = đội đá sân nhà trận đó; map về "đội hiện tại".
    const rowHomeIsCurrentHome = r.home_team_id != null && r.home_team_id === homeId;
    const label = rowHomeIsCurrentHome ? 'HOME-AWAY' : (r.home_team_id === awayId ? 'AWAY-HOME (đảo)' : '?');
    const htLead = h1h === h1a ? 'HT hòa' : h1h > h1a ? 'HT chủ dẫn' : 'HT khách dẫn';
    const ftLead = tth === tta ? 'FT hòa' : tth > tta ? 'FT chủ thắng' : 'FT khách thắng';
    const held = (h1h !== h1a) && ((h1h > h1a) === (tth > tta)) && (tth !== tta) ? '→ giữ được' : (h1h !== h1a && tth === tta ? '→ bị gỡ hòa' : '');
    return `  • [${label}] H1 ${h1h}-${h1a} / FT ${tth}-${tta} · ${htLead}, ${ftLead} ${held}`.trimEnd();
  }).join('\n');
}

// Bảng 20 trận gần nhất, orient theo đội nhà HIỆN TẠI: "ngày · HT x-y → FT a-b" (x/a = đội nhà hiện tại).
function hist20Block(rows: Hist20Row[], homeId: number | null): string {
  if (!rows.length) return '  • (chưa có lịch sử đối đầu)';
  return rows.map((r) => {
    const rowHomeIsCurrentHome = r.home_team_id != null && r.home_team_id === homeId;
    // Nếu trận đó đội nhà hiện tại đá SÂN KHÁCH → đảo tỉ số cho khớp góc nhìn "nhà hiện tại".
    const h1h = rowHomeIsCurrentHome ? (r.h1_home ?? 0) : (r.h1_away ?? 0);
    const h1a = rowHomeIsCurrentHome ? (r.h1_away ?? 0) : (r.h1_home ?? 0);
    const tth = rowHomeIsCurrentHome ? (r.tt_home ?? 0) : (r.tt_away ?? 0);
    const tta = rowHomeIsCurrentHome ? (r.tt_away ?? 0) : (r.tt_home ?? 0);
    const day = r.match_time ? String(r.match_time).slice(0, 10) : '?';
    return `  • ${day} · HT ${h1h}-${h1a} → FT ${tth}-${tta}`;
  }).join('\n');
}

const SYSTEM = `Bạn là chuyên gia phân tích kèo bóng đá ảo tốc độ (esoccer) tại thời điểm ĐẦU HIỆP 2 (half-time). Bạn KỂ CÂU CHUYỆN diễn biến hiệp 2 (đoán tỉ số chung cuộc + ai ghi nhiều hơn), RỒI mới ra 1 pick Tài/Xỉu (hoặc BỎ) VÀ 1 gợi ý kèo chấp (hoặc BỎ) theo MASTER-PLAYBOOK dưới đây. Trả lời NGẮN GỌN, tiếng Việt, và CHỈ trả về JSON đúng schema.

⚠️ CÔNG TÂM: để chỉ số Hiệp 1 (đã bóc ảo) + lịch sử đối đầu quyết định. TUYỆT ĐỐI KHÔNG thiên sẵn về Tài, Xỉu, hay BỎ. Chỉ BỎ khi data THỰC SỰ mờ/mâu thuẫn — không phải vì ngại.

MASTER-PLAYBOOK (phương pháp bắt buộc):
1. BÓC CHỈ SỐ ẢO:
   - SOT (sút trúng đích) là NEO đánh giá cơ hội thật — KHÔNG dùng tổng sút hay xG làm chuẩn.
   - TRỪ penalty ra khỏi đánh giá tấn công (1 pen ≈ 0.76 xG + 1 sút + ~1 SOT ảo).
   - Sút nhiều mà ít corner + ít SOT = ẢO (sút vu vơ), mối đe dọa ≈ 0.
   - Possession (kiểm soát bóng) BỎ QUA — không dự báo bàn thắng.
2. SỨC MẠNH THẬT (không phải "áp đảo trên giấy"):
   - tier_z (mạnh ≥ +0.6, yếu ≤ −0.6) + tỉ lệ tackles_won/tackles (độ vững phòng ngự). Thấp = bị xuyên phá → H2 dễ có bàn.
   - saves cao = thủ môn bận (đối phương tạo nhiều cơ hội thật) — là 1 dữ kiện đọc thế trận, cân nhắc 2 chiều, KHÔNG tự động fade Tài.
3. TỔNG BÀN (Tài/Xỉu):
   - Dùng TB bàn 2 đội (avg_tt) + tổng bàn lịch sử cặp làm MỐC để DỰ ĐOÁN tổng bàn chung cuộc. So tổng DỰ ĐOÁN với vạch: dự đoán TRÊN vạch → TÀI; DƯỚI vạch → XỈU. Phải quyết định 2 CHIỀU, TUYỆT ĐỐI KHÔNG mặc định 1 cửa.
   - Cẩn thận "áp đảo ẢO" (sút nhiều mà ít trúng đích + ít góc) → đừng đánh Tài chỉ vì thế trận. NHƯNG nếu 2 đội GHI KHỎE thật (ghi bàn nhiều, đã có bàn ở H1, cặp lịch sử nhiều bàn) thì TÀI là hợp lý — đừng ngại chọn Tài khi số liệu ủng hộ.
   - Tổng bàn lịch sử cặp: nếu vạch THẤP hơn nhiều so với mức 2 đội hay ghi + lịch sử 20 trận nhiều bàn → nghiêng TÀI; nếu vạch CAO hơn mức đó → nghiêng XỈU. Dựa 20 trận lịch sử mà phán, không áp cứng 1 chiều.
   - HT score đã có (bàn đã ghi) là prior mạnh cho FT.
4. H2H: đội nào hay thắng HT/FT; đội dẫn HT có GIỮ tới FT hay bị gỡ hòa.
5. BIẾN THỂ GIẢI (chỉ là NỀN — KHÔNG được dùng để loại cửa trước khi đọc data):
   - Giải V trung bình nhiều bàn hơn giải S — nhưng đó chỉ là bối cảnh chung, KHÔNG phải luật. TUYỆT ĐỐI không loại Tài chỉ vì "giải V", không ép Xỉu chỉ vì "giải S". Cửa Tài/Xỉu phải do DATA TRẬN NÀY quyết: chỉ số H1 (bóc ảo) + 20 trận đối đầu (cặp này đẻ ra tỉ số cỡ nào) + mức ghi bàn 2 đội + vạch.
6. LINE-RELATIVE (Tài/Xỉu):
   - So tổng bàn DỰ KIẾN với vạch OU. SÁT vạch (chênh < 0.5) = rủi ro CAO → giảm confidence hoặc BỎ.
   - Đệm giữa tổng DỰ ĐOÁN và vạch càng lớn (DÙ trên hay dưới vạch) → càng chắc, tăng tin. Sát vạch (chênh < 0.5) → giảm tin hoặc BỎ. Áp dụng ĐỐI XỨNG cho cả Tài lẫn Xỉu.
7. KÈO CHẤP (leg yếu — MẶC ĐỊNH BỎ):
   - Kèo chấp gần như tung đồng xu (~51%), là chân YẾU. MẶC ĐỊNH "BỎ" trừ khi có lợi thế RÕ RÀNG.
   - Chỉ nghiêng 1 cửa khi: (a) đội mạnh chấp nửa trái nhỏ VÀ đang dẫn HT, hoặc (b) tín hiệu bùng nổ rõ (1 đội áp đảo thật + đang dẫn + hay thắng đối đầu).
   - Kết hợp: sức mạnh thật (đội mạnh/yếu) + ai dẫn hết H1 + đối đầu (đội nào hay thắng) so với vạch chấp hiện tại.
   - Nếu mờ, cân bằng, hoặc đội mạnh phải chấp sâu → BỎ, đừng gượng chọn cửa.

RA QUYẾT ĐỊNH:
- DỰ ĐOÁN CÓ CÂU CHUYỆN (làm TRƯỚC): ước ngưỡng tổng bàn của cặp với thế trận H1 hiện tại → so 20 trận lịch sử (HT tương tự thường ra chung cuộc cỡ nào) → kể diễn biến H2. story (2-4 câu đời thường: ai ghi bàn H2, đội yếu có gỡ không, đội mạnh có ghi thêm không), predicted_ft (tỉ số/khoảng chung cuộc, vd "3-1 hoặc 2-1"), which_scores_more ∈ {"Nhà","Khách","Cân"} (đội ghi nhiều hơn ở H2). Pick bên dưới phải KHỚP câu chuyện này.
- Tài/Xỉu: side ∈ {"Tài","Xỉu","BỎ"}, confidence ∈ {"Cao","TB","Thấp"} (chỉ tham khảo — KHÔNG dùng để tăng cược). reasoning + redFlags.
- Kèo chấp: hc_side ∈ {"Nhà","Khách","BỎ"} (đội nhà/khách để bắt, hoặc BỎ), hc_pick (ví dụ "Vietnam (S) -0.25" hoặc "BỎ"), hc_confidence ∈ {"Cao","TB","Thấp"}, hc_reasoning. THẬT THÀ: nếu không rõ cửa thì hc_side="BỎ", hc_pick="BỎ".
VIẾT: mọi phần chữ (story, reasoning, hc_reasoning, redFlags) dùng TIẾNG VIỆT ĐỜI THƯỜNG, dễ hiểu như đang nói với người chơi kèo bình dân. TUYỆT ĐỐI KHÔNG dùng thuật ngữ/tên cột kỹ thuật (avg_total, avg_tt, tier_z, cv, SOT, xG, median, gs_pair_scoring) — thay bằng chữ Việt: SOT→"sút trúng đích", avg_tt/avg_total→"tổng bàn trung bình 2 đội", tier_z→"đội mạnh/đội yếu", cv→"thất thường", corner→"phạt góc". Không ký hiệu (1/2, ~2.1, <0.5), diễn giải bằng lời. reasoning + hc_reasoning mỗi phần 2-3 câu gọn; redFlags mỗi cái 1 cụm ngắn dễ hiểu.`;

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    pick: { type: 'string', description: 'Mô tả kèo Tài/Xỉu ngắn gọn, ví dụ "Xỉu 4.5" hoặc "BỎ"' },
    side: { type: 'string', enum: ['Tài', 'Xỉu', 'BỎ'] },
    confidence: { type: 'string', enum: ['Cao', 'TB', 'Thấp'] },
    reasoning: { type: 'string', description: 'Vài câu tiếng Việt cho pick Tài/Xỉu' },
    redFlags: { type: 'array', items: { type: 'string' }, description: 'Danh sách cảnh báo ngắn tiếng Việt' },
    // ── Dự đoán có câu chuyện — KHÔNG bắt buộc để row cache cũ / model bỏ sót không vỡ parse ──
    predicted_ft: { type: 'string', description: 'Tỉ số hoặc khoảng tỉ số chung cuộc dự đoán, ví dụ "3-1 hoặc 2-1"' },
    story: { type: 'string', description: 'Câu chuyện diễn biến hiệp 2, 2-4 câu tiếng Việt đời thường' },
    which_scores_more: { type: 'string', enum: ['Nhà', 'Khách', 'Cân'], description: 'Đội ghi nhiều bàn hơn ở hiệp 2' },
    // ── Kèo chấp (leg yếu, mặc định BỎ) — KHÔNG bắt buộc để row cache cũ / model bỏ sót không vỡ parse ──
    hc_side: { type: 'string', enum: ['Nhà', 'Khách', 'BỎ'], description: 'Cửa nghiêng trên kèo chấp: đội nhà, đội khách, hoặc BỎ' },
    hc_pick: { type: 'string', description: 'Mô tả kèo chấp ngắn gọn, ví dụ "Vietnam (S) -0.25" hoặc "BỎ"' },
    hc_confidence: { type: 'string', enum: ['Cao', 'TB', 'Thấp'], description: 'Độ tin kèo chấp (chỉ tham khảo)' },
    hc_reasoning: { type: 'string', description: 'Vài câu tiếng Việt đời thường cho kèo chấp' },
  },
  required: ['pick', 'side', 'confidence', 'reasoning', 'redFlags'],
  additionalProperties: false,
} as const;

interface AiPick {
  pick: string;
  side: 'Tài' | 'Xỉu' | 'BỎ' | string;
  confidence: 'Cao' | 'TB' | 'Thấp' | string;
  reasoning: string;
  redFlags: string[];
  hc_side?: 'Nhà' | 'Khách' | 'BỎ' | string;
  hc_pick?: string;
  hc_confidence?: 'Cao' | 'TB' | 'Thấp' | string;
  hc_reasoning?: string;
  predicted_ft?: string;
  story?: string;
  which_scores_more?: 'Nhà' | 'Khách' | 'Cân' | string;
}

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY chưa cấu hình' }, { status: 503 });
  }

  const eventRaw = req.nextUrl.searchParams.get('event') ?? req.nextUrl.searchParams.get('eventId');
  const eventId = eventRaw ? Number(eventRaw) : NaN;
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ ok: false, error: 'event không hợp lệ' }, { status: 400 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ ok: false, error: 'ANALYSIS_DATABASE_URL chưa cấu hình' }, { status: 503 });
  }

  // ── Cache-first: nếu trận này đã có kèo AI thì trả bản lưu, KHÔNG gọi Claude ──
  // Lỗi đọc cache (vd schema drift: cột thiếu ở bảng cũ) KHÔNG hard-fail — bỏ qua cache,
  // đi tính pick mới để vẫn trả kết quả dùng được, không trả ok:false cho lỗi có thể phục hồi.
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query<CacheRow>(
      `SELECT side, pick, confidence, reasoning, red_flags, model,
              hc_side, hc_pick, hc_confidence, hc_reasoning,
              predicted_ft, story, which_scores_more
       FROM gs_ai_picks WHERE event_id=$1 LIMIT 1`,
      [eventId],
    );
    if (rows[0]) {
      const c = rows[0];
      return NextResponse.json({
        ok: true,
        event_id: eventId,
        cached: true,
        pick: c.pick,
        side: c.side,
        confidence: c.confidence,
        reasoning: c.reasoning,
        redFlags: normFlags(c.red_flags),
        hc_side: c.hc_side,
        hc_pick: c.hc_pick,
        hc_confidence: c.hc_confidence,
        hc_reasoning: c.hc_reasoning,
        predicted_ft: c.predicted_ft,
        story: c.story,
        which_scores_more: c.which_scores_more,
        ai_model: c.model,
      });
    }
  } catch (e) {
    // Cache read hỏng (schema drift / bảng cũ) → log & fall-through tính pick mới.
    console.error(`[gs-ai-pick] cache read failed, computing fresh: ${(e as Error).message}`);
  }

  let ev: OddsRow | null;
  let stats: StatsRow | null;
  let hp: ProfileRow | null;
  let ap: ProfileRow | null;
  let pair: PairRow | null;
  let hist: HistRow[];
  let hist20: Hist20Row[];

  try {
    ev = await loadEvent(pool, eventId);
    if (!ev) {
      return NextResponse.json({ ok: false, error: `Không có odds snapshot cho ${eventId}` });
    }

    const [statsRes, hpRes, apRes, pairRes, histRes, hist20Res] = await Promise.all([
      pool.query<StatsRow>(`SELECT * FROM gs_ht_stats WHERE event_id=$1 LIMIT 1`, [eventId]),
      pool.query<ProfileRow>(`SELECT * FROM gs_team_profile WHERE team_id=$1 LIMIT 1`, [ev.home_team_id]),
      pool.query<ProfileRow>(`SELECT * FROM gs_team_profile WHERE team_id=$1 LIMIT 1`, [ev.away_team_id]),
      pool.query<PairRow>(
        `SELECT meetings, avg_total, cv FROM gs_pair_scoring
         WHERE (team_a=$1 AND team_b=$2) OR (team_a=$2 AND team_b=$1) LIMIT 1`,
        [ev.home_team_id, ev.away_team_id],
      ),
      pool.query<HistRow>(
        `SELECT h1_home, h1_away, tt_home, tt_away, home_team_id, match_type
         FROM gs_matches_history
         WHERE (home_team_id=$1 AND away_team_id=$2) OR (home_team_id=$2 AND away_team_id=$1)
         ORDER BY match_time DESC LIMIT 8`,
        [ev.home_team_id, ev.away_team_id],
      ),
      pool.query<Hist20Row>(
        `SELECT match_time, h1_home, h1_away, tt_home, tt_away, home_team_id
         FROM gs_matches_history
         WHERE (home_team_id=$1 AND away_team_id=$2) OR (home_team_id=$2 AND away_team_id=$1)
         ORDER BY match_time DESC LIMIT 20`,
        [ev.home_team_id, ev.away_team_id],
      ),
    ]);
    stats = statsRes.rows[0] ?? null;
    hp = hpRes.rows[0] ?? null;
    ap = apRes.rows[0] ?? null;
    pair = pairRes.rows[0] ?? null;
    hist = histRes.rows;
    hist20 = hist20Res.rows;
  } catch (e) {
    return NextResponse.json({ ok: false, error: `DB lỗi: ${(e as Error).message}` });
  }

  const variant = /\(V\)/i.test(`${ev.home_team} ${ev.away_team}`) ? 'V' : 'S';
  const hh = ev.score_home ?? 0;
  const ha = ev.score_away ?? 0;
  const htScore = `${hh}-${ha}`;

  const oddsNow: string[] = ['📊 VẠCH HIỆN TẠI (đầu hiệp 2):'];
  if (ev.ou_line != null) {
    oddsNow.push(`  • Tài/Xỉu: vạch ${ev.ou_line} — Tài ${n(ev.ou_over)} / Xỉu ${n(ev.ou_under)}`);
  } else oddsNow.push('  • Tài/Xỉu: không có vạch');
  if (ev.hc_line != null) {
    const dir = ev.hc_home_gives === true ? `${ev.home_team} chấp` : ev.hc_home_gives === false ? `${ev.away_team} chấp` : 'không rõ';
    oddsNow.push(`  • Kèo chấp: ${ev.hc_line} (${dir}) — Home ${n(ev.hc_home_odds)} / Away ${n(ev.hc_away_odds)}`);
  } else oddsNow.push('  • Kèo chấp: không có');

  const userContent = [
    `Bối cảnh trận (đầu hiệp 2, esoccer):`,
    `  • ${ev.home_team} vs ${ev.away_team}`,
    `  • Biến thể giải: ${variant} (V thường NHIỀU bàn hơn → dễ có Tài, S ít bàn hơn → dễ Xỉu; chỉ là nền, không phải luật cứng)`,
    `  • Tỉ số hết hiệp 1 (HT): ${htScore}`,
    ``,
    `🔢 CHỈ SỐ HIỆP 1 (gs_ht_stats) — nhớ BÓC ẢO (SOT là neo, trừ pen, corner-consistency):`,
    statsBlock(stats),
    ``,
    `🧬 HỒ SƠ ĐỘI (gs_team_profile):`,
    profileBlock(ev.home_team, hp),
    profileBlock(ev.away_team, ap),
    ``,
    `🤝 CẶP ĐỘI (gs_pair_scoring) — avg_total là TRẦN tổng bàn:`,
    pairBlock(pair),
    ``,
    `📚 LỊCH SỬ ĐỐI ĐẦU gần nhất (gs_matches_history) — ai thắng HT/FT, HT-leader giữ hay bị gỡ:`,
    histBlock(hist, ev.home_team_id, ev.away_team_id),
    ``,
    `📈 20 TRẬN ĐỐI ĐẦU GẦN NHẤT (mẫu để đoán "cặp này đẻ ra tỉ số cỡ nào") — góc nhìn ĐỘI NHÀ hiện tại (${ev.home_team}), đọc "HT x-y → FT a-b" với x/a là bàn của đội nhà:`,
    hist20Block(hist20, ev.home_team_id),
    ``,
    oddsNow.join('\n'),
    ``,
    `Nhiệm vụ (làm theo THỨ TỰ — kể câu chuyện TRƯỚC, ra pick SAU):`,
    `  1) Ước NGƯỠNG tổng bàn của cặp này với thế trận H1 hiện tại (vd "2 đội này đá vầy thường ra tổng khoảng X-Y bàn").`,
    `  2) So với 20 trận lịch sử ở trên: những lần HT tương tự thì chung cuộc thường ra cỡ nào.`,
    `  3) Kể CÂU CHUYỆN diễn biến hiệp 2 (story, 2-4 câu): ai sẽ ghi bàn ở H2, đội yếu có gỡ được không, đội mạnh có ghi thêm không, tỉ số kết thúc (predicted_ft) cỡ nào; và đội nào ghi nhiều hơn ở H2 (which_scores_more: Nhà/Khách/Cân).`,
    `  4) Từ câu chuyện đó → ra 1 pick Tài/Xỉu/BỎ VÀ 1 gợi ý kèo chấp (Nhà/Khách/BỎ — mặc định BỎ nếu không rõ cửa).`,
    `Trả JSON qua công cụ emit_pick.`,
  ].join('\n');

  let pick: AiPick;
  try {
    const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
    const client = new AnthropicClient();
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 650,
      system: SYSTEM,
      tools: [{
        name: 'emit_pick',
        description: 'Trả về pick Tài/Xỉu/BỎ theo MASTER-PLAYBOOK, đúng schema JSON.',
        input_schema: PICK_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: 'emit_pick' },
      messages: [{ role: 'user', content: userContent }],
    });
    const toolUse = msg.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ ok: false, error: 'AI không trả structured output' });
    }
    pick = toolUse.input as AiPick;
    if (!Array.isArray(pick.redFlags)) pick.redFlags = [];
  } catch (e) {
    return NextResponse.json({ ok: false, error: `AI lỗi: ${(e as Error).message}` });
  }

  // Lưu cache (idempotent) — lần đầu ghi, các lần sau GET lại. Lỗi ghi không chặn trả kèo.
  try {
    await pool.query(
      `INSERT INTO gs_ai_picks
         (event_id, side, pick, confidence, reasoning, red_flags, model,
          hc_side, hc_pick, hc_confidence, hc_reasoning,
          predicted_ft, story, which_scores_more, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, pick.side, pick.pick, pick.confidence, pick.reasoning,
       JSON.stringify(pick.redFlags), AI_MODEL,
       pick.hc_side ?? null, pick.hc_pick ?? null,
       pick.hc_confidence ?? null, pick.hc_reasoning ?? null,
       pick.predicted_ft ?? null, pick.story ?? null, pick.which_scores_more ?? null],
    );
  } catch {
    // bỏ qua lỗi ghi cache — vẫn trả kèo cho lần này
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    cached: false,
    home_team: ev.home_team,
    away_team: ev.away_team,
    ht_score: htScore,
    variant,
    ou_line: ev.ou_line,
    pick: pick.pick,
    side: pick.side,
    confidence: pick.confidence,
    reasoning: pick.reasoning,
    redFlags: pick.redFlags,
    hc_side: pick.hc_side ?? null,
    hc_pick: pick.hc_pick ?? null,
    hc_confidence: pick.hc_confidence ?? null,
    hc_reasoning: pick.hc_reasoning ?? null,
    predicted_ft: pick.predicted_ft ?? null,
    story: pick.story ?? null,
    which_scores_more: pick.which_scores_more ?? null,
    ai_model: AI_MODEL,
  });
}
