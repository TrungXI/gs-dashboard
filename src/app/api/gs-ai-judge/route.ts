import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// ── System prompt v3 (copied verbatim từ gs-predict CLAUDE_PROMPTS[3].system) ──
const SYSTEM_V3 = `Bạn là chuyên gia phân tích bóng đá ảo tốc độ (loại 16p và 20p — không phải bóng đá 90 phút).

Đặc điểm:
- Trận 16p chỉ có 16 phút thực tế, bàn thắng đến rất nhanh.
- Trận 20p có 20 phút thực tế.
- **Bóng đá ảo tốc độ cực kỳ biến động — bàn thắng có thể xảy ra trong vòng 30 giây bất kỳ lúc nào, kể cả khi tỉ số đang ổn định.** Không bao giờ loại trừ khả năng ghi bàn chỉ vì "ít thời gian còn lại" — 1-2 phút trong bóng đá ảo có thể thay đổi hoàn toàn kết quả.
- Phân tích ngắn gọn, cụ thể, bằng tiếng Việt.
- Luôn tính đến ảnh hưởng của thẻ vàng, thẻ đỏ và thời gian còn lại.
- Không dự đoán theo cảm tính; ưu tiên odds hiện tại, biến động odds, thống kê trận đấu, phong độ, lịch sử đối đầu và dữ liệu lịch sử tương tự.
- Dựa vào lịch sử đối đầu (H2H) theo từng hiệp để dự đoán diễn biến của hiệp hiện tại.
- Khi phân tích hiệp 2, cần kết hợp dữ liệu đối đầu hiệp 1 và hiệp 2 để nhận diện xu hướng ghi bàn sau giờ nghỉ.
- Luôn áp dụng các nguyên tắc xác suất thống kê và cân bằng xác suất.

Nguyên tắc phân tích:

1. Luôn phân biệt rõ 3 dự đoán độc lập:
   (1) Đội ghi BÀN TIẾP THEO
   (2) Đội đang THUA có khả năng GHI BÀN trong HIỆP HIỆN TẠI hay không
   (3) KẾT QUẢ CUỐI của HIỆP HIỆN TẠI và KẾT QUẢ CUỐI TRẬN

2. Ba kết luận trên có thể khác nhau.

3. Khi đánh giá xác suất phải xét đồng thời: odds hiện tại, biến động odds, tỉ số hiện tại, thời gian còn lại, phong độ, H2H toàn trận, H2H theo từng hiệp, tỷ lệ giữ lợi thế khi dẫn bàn, comeback rate khi bị dẫn, thẻ vàng/đỏ, số cú sút/phạt góc và các thống kê tấn công nếu có, xu hướng bàn thắng theo từng giai đoạn trận.

4. Nguyên tắc cân bằng thống kê (Regression to Mean): không mặc định một đội tiếp tục thắng/thua kèo mãi chỉ vì chuỗi gần đây; chuỗi quá dài → tăng trọng số khả năng đảo chiều; đây chỉ là yếu tố điều chỉnh, luôn đối chiếu odds và diễn biến thực tế.

5. Đánh giá khả năng đội đang thua ghi bàn: xét odds nghiêng về đội thua không, thời gian còn đủ không, comeback rate lịch sử, H2H tình huống tương tự, sức ép tấn công.

6. Dùng H2H theo hiệp để đánh giá khả năng có bàn; nếu H2H hiệp hiện tại và toàn trận mâu thuẫn, ưu tiên dữ liệu hiệp đang diễn ra.

7. Tránh kết luận tuyệt đối: luôn diễn đạt bằng xác suất/mức tin cậy; không dùng "100%", "chắc chắn thắng", "không thể xảy ra".

8. Tích hợp lịch sử dự đoán của chính bạn (khi được cung cấp): so sánh với kết quả thực tế để tự đánh giá đúng/sai; nếu sai thì nhận ra điểm sai và điều chỉnh trọng số; luôn ưu tiên dữ liệu thực tế hiện tại hơn dự đoán cũ.`;

// ── Odds history (tái dùng logic fetchOddsHistory từ gs-predict) ──
async function fetchOddsHistory(homeId: number | null, awayId: number | null): Promise<string | null> {
  const pool = getPool();
  if (!pool || !homeId || !awayId) return null;
  try {
    const { rows } = await pool.query<{
      snapshot_type: string; score_home: number; score_away: number; is_h2: boolean;
      hc_line: string | null; hc_home_odds: string | null; hc_away_odds: string | null;
      ou_line: string | null; ou_over: string | null; ou_under: string | null;
      event_id: number | null; home_team: string; away_team: string; recorded_at: string;
    }>(
      `SELECT snapshot_type, score_home, score_away, is_h2,
              hc_line, hc_home_odds, hc_away_odds,
              ou_line, ou_over, ou_under,
              event_id, home_team, away_team, recorded_at
       FROM match_odds_log
       WHERE (home_team_id = $1 AND away_team_id = $2)
          OR (home_team_id = $2 AND away_team_id = $1)
       ORDER BY recorded_at DESC
       LIMIT 60`,
      [homeId, awayId],
    );
    if (!rows.length) return null;

    const eventMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.event_id ? String(row.event_id) : row.recorded_at.slice(0, 10);
      if (!eventMap.has(key)) {
        if (eventMap.size >= 5) break;
        eventMap.set(key, []);
      }
      eventMap.get(key)!.push(row);
    }

    const lines: string[] = ['📈 KÈO LỊCH SỬ CẶP ĐỘI (match_odds_log):'];
    let matchNum = 1;
    for (const [, snapshots] of eventMap) {
      const ordered = [...snapshots].reverse();
      const first = ordered[0];
      lines.push(`\nTrận ${matchNum} — ${first.home_team} vs ${first.away_team}:`);
      for (const s of ordered) {
        const half = s.is_h2 ? 'H2' : 'H1';
        const hc = s.hc_line != null
          ? `HC ${s.hc_line} Home ${s.hc_home_odds ?? '-'}/Away ${s.hc_away_odds ?? '-'}`
          : 'HC -';
        const ou = s.ou_line != null
          ? `OU ${s.ou_line} Tài ${s.ou_over ?? '-'}/Xỉu ${s.ou_under ?? '-'}`
          : 'OU -';
        lines.push(`  • [${s.snapshot_type}] ${half} ${s.score_home}-${s.score_away} | ${hc} | ${ou}`);
      }
      matchNum++;
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

interface EventRow {
  home_team: string; away_team: string; home_team_id: number | null; away_team_id: number | null;
  score_home: number | null; score_away: number | null;
  hc_line: string | null; hc_home_gives: boolean | null; hc_home_odds: string | null; hc_away_odds: string | null;
  ou_line: string | null; ou_over: string | null; ou_under: string | null;
}

async function loadEvent(pool: Pool, eventId: number): Promise<EventRow | null> {
  const cols = `home_team, away_team, home_team_id, away_team_id, score_home, score_away,
                hc_line, hc_home_gives, hc_home_odds, hc_away_odds, ou_line, ou_over, ou_under`;
  const { rows } = await pool.query<EventRow>(
    `SELECT ${cols} FROM match_odds_log WHERE event_id=$1 AND period=8 ORDER BY id DESC LIMIT 1`,
    [eventId],
  );
  if (rows.length) return rows[0];
  const { rows: any } = await pool.query<EventRow>(
    `SELECT ${cols} FROM match_odds_log WHERE event_id=$1 ORDER BY id DESC LIMIT 1`,
    [eventId],
  );
  return any[0] ?? null;
}

interface RulePickRow {
  side_pick: string | null; ou_pick: string | null; confidence: string | null;
  hc_rule: string | null; ou_rule: string | null; verdict: string | null; ht_score: string | null;
}

async function loadRulePick(pool: Pool, eventId: number): Promise<RulePickRow | null> {
  const { rows } = await pool.query<RulePickRow>(
    `SELECT side_pick, ou_pick, confidence, hc_rule, ou_rule, verdict, ht_score
     FROM gs_ht_analysis WHERE event_id=$1`, [eventId],
  );
  return rows[0] ?? null;
}

interface StatsRow { [k: string]: unknown }
interface ProfileRow {
  avg_tt: string | null; avg_h1: string | null; avg_h2: string | null;
  gf_per_match: string | null; ga_per_match: string | null;
  pct_h2_scored: string | null; matches_n: number | null;
  tier: string | null; variant: string | null;
}

function n(v: unknown): string {
  return v == null ? '?' : String(v);
}

function statsBlock(s: StatsRow | null): string {
  if (!s) return '(không đọc được chỉ số Hiệp 1)';
  const pair = (label: string, h: string, a: string) => `${label}: ${n(s[h])}/${n(s[a])}`;
  return [
    pair('Kiểm soát bóng (poss)', 'home_poss', 'away_poss'),
    pair('Số cú sút (shots)', 'home_shots', 'away_shots'),
    pair('Sút trúng đích (SOT)', 'home_sot', 'away_sot'),
    pair('Cơ hội ngon (xG)', 'home_xg', 'away_xg'),
    pair('Chuyền (passes)', 'home_passes', 'away_passes'),
    pair('Chính xác chuyền (pass_acc)', 'home_pass_acc', 'away_pass_acc'),
    pair('Chính xác sút (shot_acc)', 'home_shot_acc', 'away_shot_acc'),
    pair('Chính xác rê (dribble_acc)', 'home_dribble_acc', 'away_dribble_acc'),
    pair('Tắc bóng (tackles)', 'home_tackles', 'away_tackles'),
    pair('Cắt bóng (interceptions)', 'home_interceptions', 'away_interceptions'),
    pair('Cản phá thủ môn (saves)', 'home_saves', 'away_saves'),
    pair('Phạm lỗi (fouls)', 'home_fouls', 'away_fouls'),
    pair('Việt vị (offsides)', 'home_offsides', 'away_offsides'),
    pair('Phạt góc (corners)', 'home_corners', 'away_corners'),
    pair('Đá phạt (free_kicks)', 'home_free_kicks', 'away_free_kicks'),
    pair('Penalty', 'home_penalties', 'away_penalties'),
    pair('Thẻ vàng', 'home_yellow', 'away_yellow'),
    pair('Thẻ đỏ', 'home_red', 'away_red'),
  ].map((l) => `  • ${l} (home/away)`).join('\n');
}

function profileBlock(label: string, p: ProfileRow | null): string {
  if (!p) return `${label}: (chưa có hồ sơ)`;
  return `${label}: bàn TB toàn trận ${n(p.avg_tt)}, H1 ${n(p.avg_h1)}, H2 ${n(p.avg_h2)}; `
    + `ghi TB ${n(p.gf_per_match)}, thủng TB ${n(p.ga_per_match)}; `
    + `% trận có ghi ở H2: ${n(p.pct_h2_scored)}%; mẫu ${n(p.matches_n)} trận`;
}

interface VerdictHistoryRow {
  event_id: string; side_action: string | null; ou_action: string | null; final_conf: string | null;
  rule_side: string | null; rule_ou: string | null; lesson: string | null;
  side_hit: boolean | null; ou_hit: boolean | null; ft_score: string | null;
}

function selfEvalBlock(rows: VerdictHistoryRow[]): string {
  if (!rows.length) return '(chưa có verdict AI trước đó của cặp/đội này để tự đánh giá)';
  return rows.map((r) => {
    const res = r.ft_score != null
      ? ` → KẾT QUẢ THẬT: FT ${r.ft_score}, chấp ${r.side_hit === true ? 'ĂN ✅' : r.side_hit === false ? 'THUA ❌' : '?'}, T/X ${r.ou_hit === true ? 'ĂN ✅' : r.ou_hit === false ? 'THUA ❌' : '?'}`
      : ' (chưa settle — chưa có kết quả thật)';
    const lesson = r.lesson ? `\n      ↳ bài học đã rút: ${r.lesson}` : '';
    return `  • rule chấp ${r.rule_side ?? 'BỎ'} / T/X ${r.rule_ou ?? 'BỎ'} → AI: chấp ${r.side_action ?? '?'} / T/X ${r.ou_action ?? '?'} (độ tin ${r.final_conf ?? '?'})${res}${lesson}`;
  }).join('\n');
}

// ── Bộ nhớ tự học (memory pack) — số liệu thật để trọng tài phán trên KINH NGHIỆM ──
// Wilson score lower bound (z=1.2816 ≈ 90% một phía) — KHỚP predict.v2 wilsonLB.
const WILSON_Z = 1.2816;
function wilsonLB(hits: number, nn: number, z = WILSON_Z): number {
  if (nn === 0) return 0;
  const p = hits / nn, z2 = z * z;
  const denom = 1 + z2 / nn;
  const centre = p + z2 / (2 * nn);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * nn)) / nn);
  return (centre - margin) / denom;
}
// Malay odds → net decimal.  +x → 1+x ; −x → 1 + 1/|x|.  (KHỚP predict.v2 malayToDecimal)
function malayToDecimal(m: unknown): number | null {
  const o = parseFloat(String(m));
  if (!Number.isFinite(o) || o === 0) return null;
  return o >= 0 ? 1 + o : 1 + 1 / Math.abs(o);
}
// hoà-vốn (break-even prob) từ giá Malay = 1/dec.
function breakEven(malayOdds: unknown): number | null {
  const dec = malayToDecimal(malayOdds);
  return dec == null ? null : 1 / dec;
}
// tách "@ giá" từ text pick "Xỉu 1.75 @ 0.71 (⚡...)".
function priceOf(pick: string | null): number | null {
  if (!pick) return null;
  const m = pick.match(/@\s*(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
// độ lớn line (hỗ trợ quarter "1-1.5") — KHỚP predict.v2 lineMagnitude.
function lineMag(lineStr: string | null): number | null {
  if (lineStr == null) return null;
  const m = String(lineStr).trim().match(/^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const a = parseFloat(m[1]); const b = m[2] != null ? parseFloat(m[2]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs((a + b) / 2);
}
// biên an toàn trên hoà-vốn để CẤM veto (khớp band −2% của calibrate.v2, đối xứng +2%).
const WILSON_GUARD_MARGIN = 0.02;
// Rào +EV dùng MỐC PHẲNG ~54% (thay vì hoà-vốn theo giá) để bảo vệ edge Xỉu-S sớm hơn
// khi bucket đủ mạnh, không phải chờ Wilson-LB vượt hoà-vốn cao theo giá. (chốt từ user)
const FLAT_BE = 0.54;

interface BucketStat { key: string; n: number; hitRate: number; wilsonLB: number; breakEven: number | null; clearsBE: boolean; }

interface ConfigRow { bucket_kind: string; bucket_key: string; sample_n: number | null; hit_rate: string | null; }

// Tra Wilson-LB của đúng bucket (OU: kind=Xiu|<variant>; HC: hc_line=<mag>|<variant>) từ gs_bet_config.
function bucketStat(cfg: ConfigRow[], kind: string, key: string, price: number | null, minN = 12): BucketStat | null {
  const r = cfg.find((c) => c.bucket_kind === kind && c.bucket_key === key);
  if (!r || r.sample_n == null || r.hit_rate == null || Number(r.sample_n) < minN) return null;
  const nn = Number(r.sample_n);
  const hr = Number(r.hit_rate) / 100;
  const hits = Math.round(hr * nn);
  const wlb = wilsonLB(hits, nn);
  const be = breakEven(price);
  return { key, n: nn, hitRate: hr, wilsonLB: wlb, breakEven: be,
    clearsBE: wlb >= FLAT_BE + WILSON_GUARD_MARGIN };
}

function pctS(x: number | null): string { return x == null ? '?' : `${(x * 100).toFixed(0)}%`; }

function bucketLine(label: string, s: BucketStat | null): string {
  if (!s) return `${label}: (chưa đủ mẫu để tự học — dùng nhận định định tính)`;
  const be = s.breakEven != null ? `, hoà-vốn ${pctS(s.breakEven)}` : '';
  const flag = s.clearsBE ? '  ✅ VƯỢT HOÀ-VỐN (CẤM veto)' : '';
  return `${label}: hit ${pctS(s.hitRate)}, n=${s.n}, Wilson-LB ${pctS(s.wilsonLB)}${be}${flag}`;
}

interface LessonRow { scope: string | null; lesson: string | null; sample_n: number | null; }
function lessonsBlock(rows: LessonRow[]): string {
  if (!rows.length) return '(chưa có bài học tự học liên quan)';
  return rows.map((r) => `  • [${r.scope ?? '?'}${r.sample_n != null ? ` n=${r.sample_n}` : ''}] ${r.lesson ?? ''}`).join('\n');
}

interface HighconfRow { leg: string | null; pick: string | null; ht_score: string | null; ft_score: string | null; ai_note: string | null; }
function highconfBlock(rows: HighconfRow[]): string {
  if (!rows.length) return '(chưa có ghi chú hậu-kiểm kèo tin CAO liên quan)';
  return rows.map((r) => `  • [${r.leg ?? '?'}] ${r.pick ?? ''} (HT ${r.ht_score ?? '?'}→FT ${r.ft_score ?? '?'}): ${r.ai_note ?? ''}`).join('\n');
}

interface SimilarRow { home_team: string; away_team: string; side_pick: string | null; side_hit: boolean | null; ou_pick: string | null; ou_hit: boolean | null; ht_score: string | null; ft_score: string | null; }
function hitVN(h: boolean | null): string { return h === true ? 'ĂN ✅' : h === false ? 'THUA ❌' : '—'; }
function similarBlock(rows: SimilarRow[]): string {
  if (!rows.length) return '(chưa có trận tương tự đã settle để đối chiếu)';
  return rows.map((r) => {
    const legs: string[] = [];
    if (r.side_pick && !/^bỏ/i.test(r.side_pick)) legs.push(`chấp ${r.side_pick} → ${hitVN(r.side_hit)}`);
    if (r.ou_pick && !/^bỏ/i.test(r.ou_pick)) legs.push(`T/X ${r.ou_pick} → ${hitVN(r.ou_hit)}`);
    return `  • ${r.home_team} vs ${r.away_team} (HT ${r.ht_score ?? '?'}→FT ${r.ft_score ?? '?'}): ${legs.join(' | ') || '(bỏ cả 2)'}`;
  }).join('\n');
}

const AI_MODEL = 'claude-haiku-4-5';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    side_action: {
      type: 'string', enum: ['keep', 'veto'],
      description: 'keep=GIỮ NGUYÊN kèo chấp của rule; veto=BỎ kèo chấp',
    },
    ou_action: {
      type: 'string', enum: ['keep', 'veto'],
      description: 'keep=GIỮ NGUYÊN kèo Tài/Xỉu của rule; veto=BỎ kèo Tài/Xỉu',
    },
    final_confidence: { type: 'string', enum: ['Cao', 'TB', 'Thấp'] },
    verdict_note: { type: 'string', description: 'Nhận xét trọng tài, tiếng Việt đời thường ngắn gọn' },
    lesson: { type: 'string', description: 'Đúc kết 1 câu tiếng Việt: lần này dựa vào gì, nếu sai sau này chú ý gì' },
  },
  required: ['side_action', 'ou_action', 'final_confidence', 'verdict_note', 'lesson'],
  additionalProperties: false,
} as const;

interface Verdict {
  side_action: 'keep' | 'veto';
  ou_action: 'keep' | 'veto';
  final_confidence: 'Cao' | 'TB' | 'Thấp';
  verdict_note: string; lesson: string;
}

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY chưa cấu hình' }, { status: 503 });
  }
  const eventIdRaw = req.nextUrl.searchParams.get('eventId');
  const eventId = eventIdRaw ? Number(eventIdRaw) : NaN;
  if (!Number.isFinite(eventId) || eventId <= 0) {
    return NextResponse.json({ ok: false, error: 'eventId không hợp lệ' }, { status: 400 });
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ ok: false, error: 'ANALYSIS_DATABASE_URL chưa cấu hình' }, { status: 503 });
  }

  const ev = await loadEvent(pool, eventId);
  if (!ev) {
    return NextResponse.json({ ok: false, error: `Không có odds snapshot cho ${eventId}` });
  }

  // Rule: chỉ xét khi CÓ chỉ số Hiệp 1
  const { rows: statsRows } = await pool.query<StatsRow>(
    `SELECT * FROM gs_ht_stats WHERE event_id=$1`, [eventId],
  );
  const stats = statsRows[0] ?? null;
  if (!stats) {
    return NextResponse.json({ ok: true, skip: true, reason: 'chưa có chỉ số H1' });
  }

  const rulePick = await loadRulePick(pool, eventId);
  if (!rulePick) {
    return NextResponse.json({ ok: false, error: `Chưa có kèo rule-engine (gs_ht_analysis) cho ${eventId}` });
  }

  // biến thể giải (V nhiều bàn / S ít bàn) suy từ tên đội — khớp variantOf của settle/predict.
  const variant = /\(V\)/i.test(`${ev.home_team} ${ev.away_team}`) ? 'V' : 'S';
  const ouMag = lineMag(ev.ou_line);
  const hcMag = lineMag(ev.hc_line);

  const [hp, ap, oddsHistory, verdictHist, cfgRes, lessonsRes, highconfRes, similarRes] = await Promise.all([
    pool.query<ProfileRow>(`SELECT * FROM gs_team_profile WHERE team_id=$1`, [ev.home_team_id]),
    pool.query<ProfileRow>(`SELECT * FROM gs_team_profile WHERE team_id=$1`, [ev.away_team_id]),
    fetchOddsHistory(ev.home_team_id, ev.away_team_id),
    pool.query<VerdictHistoryRow>(
      `SELECT v.event_id, v.side_action, v.ou_action, v.final_conf, v.rule_side, v.rule_ou, v.lesson,
              a.side_hit, a.ou_hit, a.ft_score
       FROM gs_ai_verdicts v
       LEFT JOIN gs_ht_analysis a ON a.event_id = v.event_id
       WHERE v.event_id <> $1
         AND a.event_id IS NOT NULL
         AND (a.home_team IN ($2, $3) OR a.away_team IN ($2, $3))
       ORDER BY v.created_at DESC LIMIT 6`,
      [eventId, ev.home_team, ev.away_team],
    ),
    // Bộ nhớ (1): số liệu bucket đã tự học (Wilson-LB) — dùng để CẤM veto kèo +EV.
    pool.query<ConfigRow>(`SELECT bucket_kind, bucket_key, sample_n, hit_rate FROM gs_bet_config`),
    // Bộ nhớ (2a): top bài học tự học liên quan bucket/matchup.
    pool.query<LessonRow>(
      `SELECT scope, lesson, sample_n FROM gs_lesson_log
       WHERE scope ILIKE $1 OR scope ILIKE $2 OR scope ILIKE $3
       ORDER BY run_at DESC LIMIT 5`,
      [`%${variant}%`, '%Xiu%', '%chap%'],
    ),
    // Bộ nhớ (2b): hậu-kiểm kèo tin CAO của chính cặp/đội này.
    pool.query<HighconfRow>(
      `SELECT h.leg, h.pick, h.ht_score, h.ft_score, h.ai_note
       FROM gs_highconf_review h JOIN gs_ht_analysis a ON a.event_id = h.event_id
       WHERE h.event_id <> $1 AND (a.home_team IN ($2,$3) OR a.away_team IN ($2,$3))
       ORDER BY h.created_at DESC LIMIT 5`,
      [eventId, ev.home_team, ev.away_team],
    ),
    // Bộ nhớ (3): trận tương tự đã settle — CÙNG cặp đội, kèm thắng/thua thật.
    pool.query<SimilarRow>(
      `SELECT home_team, away_team, side_pick, side_hit, ou_pick, ou_hit, ht_score, ft_score
       FROM gs_ht_analysis
       WHERE event_id <> $1 AND ft_score IS NOT NULL
         AND ((home_team IN ($2,$3) AND away_team IN ($2,$3)))
       ORDER BY settled_at DESC NULLS LAST LIMIT 5`,
      [eventId, ev.home_team, ev.away_team],
    ),
  ]);

  const cfg = cfgRes.rows;
  const homeTier = hp.rows[0]?.tier ?? null;
  const awayTier = ap.rows[0]?.tier ?? null;

  // Bộ nhớ (3b): nếu cặp đội chưa đủ 3 trận tương tự → bù bằng cùng "tier-vs-tier" cùng biến thể giải.
  let similar = similarRes.rows;
  if (similar.length < 3 && homeTier && awayTier) {
    const { rows: byTier } = await pool.query<SimilarRow>(
      `SELECT a.home_team, a.away_team, a.side_pick, a.side_hit, a.ou_pick, a.ou_hit, a.ht_score, a.ft_score
       FROM gs_ht_analysis a
       JOIN gs_team_profile hpf ON hpf.team_id = a.home_team_id
       JOIN gs_team_profile apf ON apf.team_id = a.away_team_id
       WHERE a.event_id <> $1 AND a.ft_score IS NOT NULL
         AND ((hpf.tier = $2 AND apf.tier = $3) OR (hpf.tier = $3 AND apf.tier = $2))
         AND (a.home_team ILIKE $4 OR a.away_team ILIKE $4)
       ORDER BY a.settled_at DESC NULLS LAST LIMIT 5`,
      [eventId, homeTier, awayTier, `%(${variant})%`],
    );
    const seen = new Set(similar.map((r) => `${r.home_team}|${r.away_team}`));
    for (const r of byTier) {
      if (similar.length >= 5) break;
      const k = `${r.home_team}|${r.away_team}`;
      if (!seen.has(k)) { seen.add(k); similar = similar.concat(r); }
    }
  }

  // Bucket Wilson-LB cho leg hiện tại (giá lấy từ odds hiện tại).
  const ouUnderPrice = ev.ou_under != null ? parseFloat(ev.ou_under) : null;
  const ouBucket = bucketStat(cfg, 'OU', `kind=Xiu|${variant}`, ouUnderPrice);
  // HC: giá của bên rule đang back (suy từ text pick), fallback giá home.
  const hcPrice = priceOf(rulePick.side_pick) ?? (ev.hc_home_odds != null ? parseFloat(ev.hc_home_odds) : null);
  const hcBucket = hcMag != null ? bucketStat(cfg, 'HC', `hc_line=${hcMag}|${variant}`, hcPrice) : null;

  // Chỉ áp cấm-veto khi rule đang ĐÁNH XỈU (mỏ Xỉu-S) và bucket Xỉu vượt hoà-vốn.
  const ruleOuIsUnder = !!rulePick.ou_pick && /xỉu|xiu|under/i.test(rulePick.ou_pick);
  const ouGuardActive = ruleOuIsUnder && !!ouBucket?.clearsBE;
  const hcGuardActive = !!rulePick.side_pick && !/^bỏ/i.test(rulePick.side_pick) && !!hcBucket?.clearsBE;
  void ouMag;

  const hh = ev.score_home ?? 0;
  const ha = ev.score_away ?? 0;
  const htScore = rulePick.ht_score ?? `${hh}-${ha}`;

  const oddsNow: string[] = ['📊 KÈO HIỆN TẠI (đầu hiệp 2):'];
  if (ev.hc_line != null) {
    const dir = ev.hc_home_gives === true ? `${ev.home_team} chấp` : ev.hc_home_gives === false ? `${ev.away_team} chấp` : 'không rõ ai chấp';
    oddsNow.push(`  • Kèo chấp: line ${ev.hc_line} (${dir}) — Home ${n(ev.hc_home_odds)} / Away ${n(ev.hc_away_odds)}`);
  } else oddsNow.push('  • Kèo chấp: không có');
  if (ev.ou_line != null) {
    oddsNow.push(`  • Tài/Xỉu: line ${ev.ou_line} — Tài ${n(ev.ou_over)} / Xỉu ${n(ev.ou_under)}`);
  } else oddsNow.push('  • Tài/Xỉu: không có');

  const userContent = [
    `Bối cảnh trận (đầu hiệp 2 bóng đá ảo):`,
    `  • ${ev.home_team} vs ${ev.away_team}`,
    `  • Tỉ số hết hiệp 1 (HT): ${htScore}`,
    ``,
    `🔢 CHỈ SỐ HIỆP 1 (gs_ht_stats):`,
    statsBlock(stats),
    ``,
    `🧬 HỒ SƠ ĐỘI (gs_team_profile):`,
    profileBlock(ev.home_team, hp.rows[0] ?? null),
    profileBlock(ev.away_team, ap.rows[0] ?? null),
    ``,
    oddsNow.join('\n'),
    ``,
    oddsHistory ?? '📈 KÈO LỊCH SỬ CẶP ĐỘI: (không có)',
    ``,
    `📚 LỊCH SỬ TỰ HỌC — các lần xét trước + KẾT QUẢ THẬT (sau settle) + bài học đã rút:`,
    `(Đọc kỹ, TỰ ĐÁNH GIÁ lần trước đúng/sai, rút kinh nghiệm rồi mới xét kèo lần này.)`,
    selfEvalBlock(verdictHist.rows),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🧠 BỘ NHỚ TỰ HỌC (số liệu THẬT — dùng để phán trên KINH NGHIỆM, không phán cảm tính):`,
    ``,
    `① TỈ LỆ ĂN THẬT CỦA ĐÚNG BUCKET (kèm cận dưới Wilson 90% & hoà-vốn từ giá):`,
    bucketLine(`  Xỉu | ${variant}`, ouBucket),
    bucketLine(`  Chấp line ${hcMag ?? '?'} | ${variant}`, hcBucket),
    `  → "Wilson-LB" = mức ăn TỐI THIỂU chắc chắn ở 90% tin cậy. Bucket nào đánh dấu ✅ VƯỢT HOÀ-VỐN nghĩa là kèo đó THỐNG KÊ ĐÃ CÓ LỜI — bạn KHÔNG được veto (xem ràng buộc 0 bên dưới).`,
    ``,
    `② TOP BÀI HỌC ĐÃ RÚT (gs_lesson_log — bẫy lặp lại trong bucket/matchup này):`,
    lessonsBlock(lessonsRes.rows),
    ``,
    `③ HẬU-KIỂM KÈO TIN CAO ĐÃ THUA của cặp/đội này (gs_highconf_review — tín hiệu H1 từng đánh lừa):`,
    highconfBlock(highconfRes.rows),
    ``,
    `④ TRẬN TƯƠNG TỰ ĐÃ SETTLE (cùng cặp / cùng hạng-đấu-hạng) + kèo → THẮNG/THUA THẬT:`,
    similarBlock(similar as SimilarRow[]),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚖️ KÈO CỦA RULE-ENGINE (bạn là TRỌNG TÀI, xét lại kèo này):`,
    `  • Kèo chấp: ${rulePick.side_pick ?? 'BỎ'}`,
    `  • Tài/Xỉu: ${rulePick.ou_pick ?? 'BỎ'}`,
    `  • Độ tin rule: ${rulePick.confidence ?? '?'}`,
    `  • Luật đã fire (hc_rule): ${rulePick.hc_rule ?? '-'} | (ou_rule): ${rulePick.ou_rule ?? '-'}`,
    rulePick.verdict ? `  • Diễn giải rule:\n${rulePick.verdict.split('\n').map((l) => '      ' + l).join('\n')}` : '',
    ``,
    `Nhiệm vụ: XÉT LẠI kèo rule-engine ở trên. Bạn là TRỌNG TÀI PHỤ — một BỘ LỌC ĐỊNH TÍNH, KHÔNG phải người ra kèo.`,
    ``,
    `🧭 VAI TRÒ (đọc kỹ): Toán học quyết định (cổng EV + Wilson của rule-engine) là NGƯỜI QUYẾT CHÍNH.`,
    `Việc của bạn CHỈ là bắt các BẪY ĐỊNH TÍNH mà luật bỏ sót (tín hiệu H1 đánh lừa, kịch bản mâu thuẫn, giá bèo).`,
    `Bạn KHÔNG có quyền lật một kèo đã VỮNG VỀ THỐNG KÊ. Khi phân vân → NGHIÊNG VỀ KEEP.`,
    ``,
    `⛔ TUYỆT ĐỐI: Bạn KHÔNG được đổi hay viết lại nội dung kèo (line, giá, tên đội). KHÔNG tự bịa line hay giá.`,
    `Với MỖI leg (kèo chấp và Tài/Xỉu) chỉ được chọn 1 trong 2:`,
    `  - keep: kèo hợp lý → GIỮ NGUYÊN đúng line + giá của rule.`,
    `  - veto: kèo sai / mâu thuẫn / giá không đáng → BỎ leg đó.`,
    `Và đặt lại 1 độ tin chung (final_confidence).`,
    ``,
    `RÀNG BUỘC ĐỂ QUYẾT ĐỊNH keep/veto (dựa vào các luật đã chốt):`,
    `0. 🔒 RÀO CỨNG — CẤM VETO KÈO ĐÃ +EV: nếu bucket của leg ở phần "① TỈ LỆ ĂN THẬT" có Wilson-LB VƯỢT HOÀ-VỐN (đánh dấu ✅), bạn PHẢI keep leg đó, CẤM veto — dù cảm thấy "gợn". Đây là mỏ tiền có lời thống kê (vd Xỉu|S), veto = tự tay bỏ lời.`
      + (ouGuardActive ? `  ⇒ HIỆN TẠI: leg Tài/Xỉu (${rulePick.ou_pick}) RƠI VÀO RÀO NÀY → BẮT BUỘC keep.` : '')
      + (hcGuardActive ? `  ⇒ HIỆN TẠI: leg kèo chấp (${rulePick.side_pick}) RƠI VÀO RÀO NÀY → BẮT BUỘC keep.` : ''),
    `1. Nếu kèo chấp là 'keep' (rule có ra chấp) mà Tài/Xỉu của rule lại là XỈU → PHẢI veto leg Tài/Xỉu (chấp + Xỉu mâu thuẫn kịch bản: có bàn thì thua Xỉu). (Trừ khi ràng buộc 0 cấm veto Xỉu — khi đó veto kèo CHẤP thay vì Xỉu.)`,
    `2. Giá kèo (Malay) chỉ đáng khi ≥ 0.60 HOẶC ÂM. Leg nào có giá rơi vào 0..0.60 (vd 0.04) = ăn không đáng → veto leg đó.`,
    `3. Tài/Xỉu: đánh giá theo thông số đá H2 THẬT của 2 đội (avg_h2, pct_h2_scored) — KHÔNG dựa nhãn giải ít/nhiều bàn. Nếu hướng Tài/Xỉu của rule ngược hẳn với dữ liệu H2 → veto (trừ khi ràng buộc 0 cấm).`,
    `4. Kèo chấp: nếu là chấp nặng (|line| ≥ 0.75) hoặc chấp đội mạnh chỉ vì lấn sân H1 → cân nhắc veto (trừ khi ràng buộc 0 cấm).`,
    `5. Kèo nào rule đã 'BỎ' sẵn thì cứ để veto (không có gì để giữ).`,
    `6. verdict_note viết tiếng Việt đời thường, ngắn gọn (1-2 câu).`,
    `7. LUÔN kết thúc bằng 1 câu "lesson" ngắn tiếng Việt: đúc kết lần này dựa vào gì + gợi ý nếu sai sau này chú ý gì (để lần sau xét chuẩn hơn).`,
    ``,
    `Trả kết quả qua công cụ judge_bet đúng schema (side_action, ou_action, final_confidence, verdict_note, lesson).`,
  ].filter((l) => l !== '').join('\n');

  let verdict: Verdict;
  try {
    const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
    const client = new AnthropicClient();
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1200,
      system: SYSTEM_V3,
      tools: [{
        name: 'judge_bet',
        description: 'Xét lại kèo rule-engine: mỗi leg keep/veto + đặt lại độ tin (KHÔNG viết lại line/giá)',
        input_schema: VERDICT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      }],
      tool_choice: { type: 'tool', name: 'judge_bet' },
      messages: [{ role: 'user', content: userContent }],
    });
    const toolUse = msg.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ ok: false, error: 'Claude không trả structured output' });
    }
    verdict = toolUse.input as Verdict;
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Claude lỗi: ${(e as Error).message}` });
  }

  // 🔒 RÀO CỨNG (đối xứng ràng buộc 0 trong prompt): trọng tài là bộ lọc PHỤ,
  // KHÔNG được lật kèo đã +EV. Nếu bucket Wilson-LB vượt hoà-vốn mà model vẫn veto
  // → cưỡng bức về keep. Bảo vệ mỏ Xỉu-S khỏi bị veto nhầm, không phụ thuộc Haiku.
  const guardNotes: string[] = [];
  if (ouGuardActive && verdict.ou_action === 'veto') {
    verdict.ou_action = 'keep';
    guardNotes.push(`[rào +EV] giữ lại Xỉu (Wilson-LB ${pctS(ouBucket!.wilsonLB)} > hoà-vốn ${pctS(ouBucket!.breakEven)}).`);
  }
  if (hcGuardActive && verdict.side_action === 'veto') {
    verdict.side_action = 'keep';
    guardNotes.push(`[rào +EV] giữ lại kèo chấp (Wilson-LB ${pctS(hcBucket!.wilsonLB)} > hoà-vốn ${pctS(hcBucket!.breakEven)}).`);
  }
  if (guardNotes.length) verdict.verdict_note = `${verdict.verdict_note} ${guardNotes.join(' ')}`.trim();

  const actionCombined = `hc:${verdict.side_action}/ou:${verdict.ou_action}`;

  // Upsert vào gs_ai_verdicts
  try {
    await pool.query(
      `INSERT INTO gs_ai_verdicts
         (event_id, rule_side, rule_ou, rule_conf, side_action, ou_action, action, final_conf, verdict_note, lesson, ai_model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (event_id) DO UPDATE SET
         rule_side=EXCLUDED.rule_side, rule_ou=EXCLUDED.rule_ou, rule_conf=EXCLUDED.rule_conf,
         side_action=EXCLUDED.side_action, ou_action=EXCLUDED.ou_action, action=EXCLUDED.action,
         final_conf=EXCLUDED.final_conf, verdict_note=EXCLUDED.verdict_note,
         lesson=EXCLUDED.lesson, ai_model=EXCLUDED.ai_model, created_at=now()`,
      [eventId, rulePick.side_pick, rulePick.ou_pick, rulePick.confidence,
       verdict.side_action, verdict.ou_action, actionCombined,
       verdict.final_confidence, verdict.verdict_note, verdict.lesson, AI_MODEL],
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Lưu DB lỗi: ${(e as Error).message}` });
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    home_team: ev.home_team,
    away_team: ev.away_team,
    ht_score: htScore,
    rule_side: rulePick.side_pick,
    rule_ou: rulePick.ou_pick,
    rule_conf: rulePick.confidence,
    side_action: verdict.side_action,
    ou_action: verdict.ou_action,
    final_confidence: verdict.final_confidence,
    verdict_note: verdict.verdict_note,
    lesson: verdict.lesson,
    ai_model: AI_MODEL,
  });
}
