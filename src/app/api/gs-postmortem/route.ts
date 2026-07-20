// AI post-mortem — khi 1 kèo "độ tin CAO" THUA, giải thích NGẮN GỌN tín hiệu H1 nào
// đã đánh lừa + 1 bài học. Called by settle.js (VPS) on a fresh high-conf loss.
// Đọc gs_ht_analysis + gs_ht_stats từ gs_db (ANALYSIS_DATABASE_URL), gọi Claude Haiku,
// trả JSON { ok, note }. Không ghi DB (settle.js lo phần upsert gs_highconf_review).
import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';

// lazy pool → gs_db on the VPS (same env var ht-ocr uses)
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!process.env.ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL, max: 2 });
  return _pool;
}

// H1 stat cols we hand to the model (from gs_ht_stats) — plain numbers, both sides.
const STAT_COLS = [
  'home_poss', 'away_poss', 'home_shots', 'away_shots', 'home_sot', 'away_sot',
  'home_xg', 'away_xg', 'home_corners', 'away_corners',
];

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, error: 'ANTHROPIC_API_KEY not set' }, { status: 503 });
  }
  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId || !/^\d+$/.test(eventId)) {
    return Response.json({ ok: false, error: 'bad eventId' }, { status: 400 });
  }

  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'ANALYSIS_DATABASE_URL not set' }, { status: 503 });

  let a: Record<string, unknown>;
  let s: Record<string, unknown> | null;
  try {
    const { rows: aRows } = await pool.query(
      `SELECT home_team, away_team, ht_score, ft_score, side_pick, ou_pick, confidence,
              hc_rule, ou_rule, side_hit, ou_hit
       FROM gs_ht_analysis WHERE event_id=$1 LIMIT 1`, [eventId]);
    if (!aRows.length) return Response.json({ ok: false, error: `no analysis for ${eventId}` }, { status: 404 });
    a = aRows[0];
    const { rows: sRows } = await pool.query(
      `SELECT ${STAT_COLS.join(', ')} FROM gs_ht_stats WHERE event_id=$1 LIMIT 1`, [eventId]);
    s = sRows.length ? sRows[0] : null;
  } catch (e) {
    return Response.json({ ok: false, error: `db: ${(e as Error).message}` }, { status: 502 });
  }

  const statLine = s
    ? `Kiểm soát ${s.home_poss ?? '?'}/${s.away_poss ?? '?'}%, sút ${s.home_shots ?? '?'}/${s.away_shots ?? '?'}, ` +
      `sút trúng ${s.home_sot ?? '?'}/${s.away_sot ?? '?'}, cơ hội ngon (xG) ${s.home_xg ?? '?'}/${s.away_xg ?? '?'}, ` +
      `phạt góc ${s.home_corners ?? '?'}/${s.away_corners ?? '?'}`
    : '(không có chỉ số H1)';

  const prompt =
    'Kèo bóng đá "độ tin CAO" này ĐÃ THUA. Bạn là chuyên gia đọc kèo, phân tích NGẮN GỌN bằng tiếng Việt.\n' +
    `Trận: ${a.home_team} vs ${a.away_team}\n` +
    `Tỉ số hết H1: ${a.ht_score} → kết thúc: ${a.ft_score}\n` +
    `Kèo chấp đã chọn: ${a.side_pick} (luật ${a.hc_rule ?? '—'}, ${a.side_hit === false ? 'THUA' : a.side_hit === true ? 'thắng' : 'không chấm'})\n` +
    `Kèo Tài/Xỉu đã chọn: ${a.ou_pick} (luật ${a.ou_rule ?? '—'}, ${a.ou_hit === false ? 'THUA' : a.ou_hit === true ? 'thắng' : 'không chấm'})\n` +
    `Chỉ số hiệp 1: ${statLine}\n\n` +
    'Phân tích: (1) tín hiệu nào lúc ra kèo đã ĐÁNH LỪA — vì sao thế trận H1 trông mạnh nhưng H2 không ra bàn/thua; ' +
    '(2) 1 bài học để lần sau bớt tự tin sai.\n' +
    'Trả về DUY NHẤT 1 JSON dạng {"note": string} — note ≤ 400 ký tự, tiếng Việt đời thường, KHÔNG markdown, KHÔNG giải thích thêm.';

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    } as any);
    const blocks = msg.content as Array<{ type: string; text?: string }>;
    const txt = (blocks.find((b) => b.type === 'text')?.text ?? '{}').replace(/```json|```/g, '').trim();
    let note = '';
    try {
      note = String(JSON.parse(txt).note ?? '').trim();
    } catch {
      note = txt.slice(0, 400); // model didn't return clean JSON → use raw text
    }
    if (!note) return Response.json({ ok: false, error: 'empty note' }, { status: 502 });
    return Response.json({ ok: true, note });
  } catch (e) {
    return Response.json({ ok: false, error: `haiku: ${(e as Error).message}` }, { status: 502 });
  }
}
