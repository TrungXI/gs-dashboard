import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAIR_WHITELIST_FILE = process.env.PAIR_WHITELIST_FILE || '/opt/gs-collector/tx-paper/pair-whitelist-r4d.json';

// Pairing WHITELIST động của 4 con Real (model PAIR_WL 2026-08-07) — đọc từ file bot ghi.
// 4 con Real CHỈ đánh Xỉu khi cặp đang đá nằm trong list này. Mỗi cặp "A|B" (2 baseName sort).
// Thiếu file → trả rỗng (khi PAIR_WL=1 mà rỗng = bot không đánh gì).
export async function GET() {
  try {
    const raw = await readFile(PAIR_WHITELIST_FILE, 'utf8');
    const arr = JSON.parse(raw).include_pairs;
    const pairs = Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    return Response.json({ ok: true, pairs });
  } catch {
    return Response.json({ ok: true, pairs: [], fallback: true });
  }
}
