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
       ADD COLUMN IF NOT EXISTS side        text,
       ADD COLUMN IF NOT EXISTS pick        text,
       ADD COLUMN IF NOT EXISTS confidence  text,
       ADD COLUMN IF NOT EXISTS reasoning   text,
       ADD COLUMN IF NOT EXISTS red_flags   jsonb,
       ADD COLUMN IF NOT EXISTS model       text,
       ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now()`,
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

const SYSTEM = `Bạn là chuyên gia phân tích kèo bóng đá ảo tốc độ (esoccer) tại thời điểm ĐẦU HIỆP 2 (half-time). Bạn ra 1 pick Tài/Xỉu (hoặc BỎ) theo MASTER-PLAYBOOK dưới đây. Trả lời NGẮN GỌN, tiếng Việt, và CHỈ trả về JSON đúng schema.

⚠️ Đây là bot THỬ NGHIỆM — chưa được chứng minh (đang thua ~2/10). Hãy thận trọng, thiên về BỎ khi tín hiệu mờ.

MASTER-PLAYBOOK (phương pháp bắt buộc):
1. BÓC CHỈ SỐ ẢO:
   - SOT (sút trúng đích) là NEO đánh giá cơ hội thật — KHÔNG dùng tổng sút hay xG làm chuẩn.
   - TRỪ penalty ra khỏi đánh giá tấn công (1 pen ≈ 0.76 xG + 1 sút + ~1 SOT ảo).
   - Sút nhiều mà ít corner + ít SOT = ẢO (sút vu vơ), mối đe dọa ≈ 0.
   - Possession (kiểm soát bóng) BỎ QUA — không dự báo bàn thắng.
2. SỨC MẠNH THẬT (không phải "áp đảo trên giấy"):
   - tier_z (mạnh ≥ +0.6, yếu ≤ −0.6) + tỉ lệ tackles_won/tackles (độ vững phòng ngự). Thấp = bị xuyên phá → H2 dễ có bàn.
   - saves cao = thủ môn bận = cơ hội đang bị chặn → fade Tài.
3. TỔNG BÀN (Tài/Xỉu):
   - Dùng TB bàn 2 đội (avg_tt) làm TRẦN. 2 đội avg_tt thấp → tới ngưỡng sẽ ghi CHẬM lại → nghiêng XỈU.
   - ĐỪNG để "đang tạo nhiều SOT" dụ đánh Tài — SOT ở esoccer thường KHÔNG chuyển hóa thành bàn ở H2.
   - avg_total (gs_pair_scoring) là TRẦN tổng bàn của cặp: nếu < median giải → chặn Tài, mặc định Xỉu.
   - HT score đã có (bàn đã ghi) là prior mạnh cho FT.
4. H2H: đội nào hay thắng HT/FT; đội dẫn HT có GIỮ tới FT hay bị gỡ hòa.
5. GIẢI/BIẾN THỂ:
   - Giải (V) + Tài = BẪY THUA → NÉ. Xỉu ở giải (S) là edge tốt nhất (~60-66%).
   - HC (kèo chấp) yếu, thường BỎ — không phải nhiệm vụ chính của tab này.
6. LINE-RELATIVE:
   - So tổng bàn DỰ KIẾN với vạch OU. SÁT vạch (chênh < 0.5) = rủi ro CAO → giảm confidence hoặc BỎ.
   - Chỉ đánh Xỉu khi vạch Under có đệm (≥ ~1.5 so với HT total).

RA QUYẾT ĐỊNH: 1 pick duy nhất. side ∈ {"Tài","Xỉu","BỎ"}. confidence ∈ {"Cao","TB","Thấp"} (chỉ để tham khảo — KHÔNG dùng để tăng cược). reasoning: vài câu tiếng Việt giải thích ngắn. redFlags: mảng cảnh báo (ảo, sát vạch, mẫu ít, giải V...).`;

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    pick: { type: 'string', description: 'Mô tả kèo ngắn gọn, ví dụ "Xỉu 4.5" hoặc "BỎ"' },
    side: { type: 'string', enum: ['Tài', 'Xỉu', 'BỎ'] },
    confidence: { type: 'string', enum: ['Cao', 'TB', 'Thấp'] },
    reasoning: { type: 'string', description: 'Vài câu tiếng Việt' },
    redFlags: { type: 'array', items: { type: 'string' }, description: 'Danh sách cảnh báo ngắn tiếng Việt' },
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
      `SELECT side, pick, confidence, reasoning, red_flags, model
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

  try {
    ev = await loadEvent(pool, eventId);
    if (!ev) {
      return NextResponse.json({ ok: false, error: `Không có odds snapshot cho ${eventId}` });
    }

    const [statsRes, hpRes, apRes, pairRes, histRes] = await Promise.all([
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
    ]);
    stats = statsRes.rows[0] ?? null;
    hp = hpRes.rows[0] ?? null;
    ap = apRes.rows[0] ?? null;
    pair = pairRes.rows[0] ?? null;
    hist = histRes.rows;
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
    `  • Biến thể giải: ${variant} (V=nhiều bàn/bẫy Tài, S=ít bàn/edge Xỉu)`,
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
    oddsNow.join('\n'),
    ``,
    `Nhiệm vụ: theo MASTER-PLAYBOOK, ra 1 pick Tài/Xỉu/BỎ cho phần còn lại của trận. Trả JSON qua công cụ emit_pick.`,
  ].join('\n');

  let pick: AiPick;
  try {
    const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
    const client = new AnthropicClient();
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 400,
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
      `INSERT INTO gs_ai_picks (event_id, side, pick, confidence, reasoning, red_flags, model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, now())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, pick.side, pick.pick, pick.confidence, pick.reasoning,
       JSON.stringify(pick.redFlags), AI_MODEL],
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
    ai_model: AI_MODEL,
  });
}
