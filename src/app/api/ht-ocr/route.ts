// P1 OCR via AI — read the GS HT "Summary" panel with Claude Haiku vision.
// Returns stats keyed 1:1 to gs_ht_stats numeric columns (extract-stats.js on the
// VPS does the DB meta + upsert). Pure OCR service — no DB writes here.
// Frames are pulled from the VPS static server (:9999). Fallback to tesseract lives
// on the VPS side (extract-stats.js) if this route errors.
import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VPS = 'http://103.82.23.48:9999/frames';
const MODEL = 'claude-haiku-4-5';

// lazy pool for the cost/usage log (ANALYSIS_DATABASE_URL = VPS gs_db)
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!process.env.ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL, max: 2 });
  return _pool;
}

// panel rows we read from the image (home_/away_). xg is decimal, rest integer.
const INT_FIELDS = ['poss', 'shots', 'passes', 'tackles', 'tackles_won', 'interceptions', 'saves',
  'fouls', 'offsides', 'corners', 'free_kicks', 'penalties', 'yellow', 'red',
  'dribble_acc', 'shot_acc', 'pass_acc'];
const NUM_FIELDS = ['xg'];
const PCT_FIELDS = ['poss', 'dribble_acc', 'shot_acc', 'pass_acc'];
const COUNT_CAPS: Record<string, number> = {
  shots: 40, passes: 400, corners: 20, yellow: 8, red: 3, saves: 20,
  tackles: 40, tackles_won: 40, interceptions: 30, fouls: 30, offsides: 15,
  free_kicks: 30, penalties: 5,
};

const KEYS = ['home', 'away'].flatMap((s) => [...INT_FIELDS, ...NUM_FIELDS].map((f) => `${s}_${f}`));

const PROMPT =
  'Các ảnh là CÙNG MỘT trận bóng tại cùng thời điểm hiệp 1 (nhiều ảnh chụp liên tiếp nhau). ' +
  'Nhiệm vụ: đọc panel "SUMMARY" — panel DUY NHẤT hiển thị ĐỦ các dòng Possession %, Shots, ' +
  'Expected Goals, Passes cùng lúc. CHỌN ảnh có panel SUMMARY RÕ NHẤT, BỎ QUA các ảnh chỉ hiện tab ' +
  'khác (chỉ Possession, Defending, Shooting…) hoặc màn logo/chuyển cảnh. Đọc ĐẦY ĐỦ các dòng giữa: ' +
  'Possession %, Shots, Expected Goals, Passes, Tackles, Tackles Won, Interceptions, Saves, ' +
  'Fouls Committed, Offsides, Corners, Free Kicks, Penalty Kicks, Yellow Cards, Red Cards; ' +
  'và 3 vòng tròn % 2 bên (DRIBBLE SUCCESS RATE → dribble_acc, SHOT ACCURACY → shot_acc, ' +
  'PASS ACCURACY → pass_acc). Số BÊN TRÁI = home, BÊN PHẢI = away. ' +
  'Cố ĐỌC ĐỦ mọi field có trong ảnh — chỉ để null khi field THẬT SỰ không xuất hiện / không đọc nổi ở BẤT KỲ ảnh nào.\n\n' +
  'RÀNG BUỘC BẮT BUỘC (tự kiểm trước khi trả):\n' +
  '- home_poss + away_poss = 100 (đúng chính xác). Nếu đọc ra không bằng 100, ĐỌC LẠI số 2 chữ số cho kỹ.\n' +
  '- home_xg, away_xg trong khoảng 0.0–6.0 (số thập phân 1 chữ số, vd 2.4).\n' +
  '- dribble_acc, shot_acc, pass_acc là % 0–100 (số nguyên trong vòng tròn, vd 86).\n' +
  '- Tackles Won ≤ Tackles; Penalty Kicks thường 0–2.\n' +
  '- Đọc kỹ số 2 chữ số (poss/passes), đừng nhầm 1 chữ số.\n\n' +
  'Trả về DUY NHẤT 1 JSON với ĐÚNG các key sau (số, hoặc null nếu THẬT SỰ không đọc được), ' +
  'KHÔNG thêm/bớt/đổi tên key, không giải thích:\n' + JSON.stringify(KEYS);

export async function GET(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 503 });
  }
  const eventId = req.nextUrl.searchParams.get('eventId');
  if (!eventId || !/^\d+$/.test(eventId)) {
    return Response.json({ error: 'bad eventId' }, { status: 400 });
  }

  // pull frames 00..09 in parallel
  const imgs = (await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const nn = String(i).padStart(2, '0');
      try {
        const r = await fetch(`${VPS}/${eventId}/${nn}.jpg`, { cache: 'no-store' });
        if (!r.ok) return null;
        return Buffer.from(await r.arrayBuffer()).toString('base64');
      } catch { return null; }
    }),
  )).filter((b): b is string => !!b);
  if (!imgs.length) return Response.json({ error: `no frames for ${eventId}` }, { status: 404 });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const content: Array<Record<string, unknown>> = imgs.map((b64) => ({
    type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
  }));
  content.push({ type: 'text', text: PROMPT });

  let raw: Record<string, number | null> = {};
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: content as any }],
    } as any);
    usage = msg.usage;
    const blocks = msg.content as Array<{ type: string; text?: string }>;
    const txt = (blocks.find((b) => b.type === 'text')?.text ?? '{}').replace(/```json|```/g, '').trim();
    raw = JSON.parse(txt);
  } catch (e) {
    return Response.json({ error: `haiku: ${(e as Error).message}` }, { status: 502 });
  }

  // ── sanity checks (mirror extract_stats.py) → build stats keyed to gs_ht_stats ──
  const problems: string[] = [];
  const ALIAS: Record<string, string> = {
    yellow: 'yellow_cards', red: 'red_cards', shot_acc: 'shot_accuracy',
    pass_acc: 'pass_accuracy', fouls: 'fouls_committed',
    dribble_acc: 'dribble_success_rate', tackles_won: 'tackles_won',
    free_kicks: 'free_kicks', penalties: 'penalty_kicks',
  };
  const num = (k: string) => {
    if (typeof raw[k] === 'number') return raw[k];
    const side = k.startsWith('home') ? 'home' : 'away';
    const base = k.replace(/^home_|^away_/, '');
    const alt = ALIAS[base] ? `${side}_${ALIAS[base]}` : null;
    if (alt && typeof raw[alt] === 'number') return raw[alt];
    return null;
  };

  const stats: Record<string, number | null> = {};
  for (const side of ['home', 'away']) {
    for (const f of [...INT_FIELDS, ...NUM_FIELDS]) stats[`${side}_${f}`] = num(`${side}_${f}`);
  }
  // possession must sum ~100
  const ph = stats.home_poss, pa = stats.away_poss;
  if (ph != null && pa != null && Math.abs(ph + pa - 100) > 3) {
    problems.push(`poss_sum=${ph + pa}`); stats.home_poss = null; stats.away_poss = null;
  }
  // xg 0..6
  for (const k of ['home_xg', 'away_xg']) {
    const v = stats[k]; if (v != null && !(v >= 0 && v <= 6)) { problems.push(`${k}=${v}(xg)`); stats[k] = null; }
  }
  // percentages 0..100
  for (const side of ['home', 'away']) for (const f of PCT_FIELDS) {
    const k = `${side}_${f}`, v = stats[k];
    if (v != null && !(v >= 0 && v <= 100)) { problems.push(`${k}=${v}(pct)`); stats[k] = null; }
  }
  // count caps + non-negative
  for (const [k, v] of Object.entries(stats)) {
    if (v == null) continue;
    const base = k.replace(/^home_|^away_/, '');
    if (base in COUNT_CAPS) {
      if (v < 0) { problems.push(`${k}=${v}(neg)`); stats[k] = null; }
      else if (v > COUNT_CAPS[base]) { problems.push(`${k}=${v}(cap)`); stats[k] = null; }
    }
  }
  // derive SOT = round(shots * shot_acc/100)
  for (const side of ['home', 'away']) {
    const sh = stats[`${side}_shots`], acc = stats[`${side}_shot_acc`];
    stats[`${side}_sot`] = (sh != null && acc != null) ? Math.round((sh * acc) / 100) : null;
  }

  const missing = Object.entries(stats).filter(([, v]) => v == null).map(([k]) => k);
  const partial = problems.length > 0 || missing.length > 0;
  if (missing.length) problems.push('missing=' + missing.join(','));
  const filled = Object.values(stats).filter((v) => v != null).length;
  const cost = usage.input_tokens * 1e-6 + usage.output_tokens * 5e-6; // Haiku 4.5 $1/$5 per 1M

  // best-effort usage/cost log — never blocks the OCR response
  try {
    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO gs_ai_ocr_log
           (event_id, frames_sent, input_tokens, output_tokens, cost_usd, fields_filled, stats_partial)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [Number(eventId), imgs.length, usage.input_tokens, usage.output_tokens,
          Number(cost.toFixed(6)), filled, partial],
      );
    }
  } catch { /* logging must not fail the OCR */ }

  return Response.json({
    panel_frame: 'haiku',
    source: 'haiku',
    frames_sent: imgs.length,
    fields_filled: filled,
    fields_total: Object.keys(stats).length,
    stats_partial: partial,
    notes: problems.join('; '),
    stats,
    cost_usd: Number((usage.input_tokens * 1e-6 + usage.output_tokens * 5e-6).toFixed(5)),
  });
}
