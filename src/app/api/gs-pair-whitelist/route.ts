import { readFile, writeFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAIR_WHITELIST_FILE = process.env.PAIR_WHITELIST_FILE || '/opt/gs-collector/tx-paper/pair-whitelist-r4d.json';

// 2 baseName sort '|'-join (khớp cách bot sinh key). Bỏ cặp rỗng/không hợp lệ.
function normPairs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = input
    .map((p) => String(p).split('|').map((t) => t.trim()).filter(Boolean).sort().join('|'))
    .filter((p) => p.includes('|'));
  return [...new Set(out)];
}

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

// SET pairing-whitelist — ghi file mà 4 con Real + Test Whitelist đọc động (reload ~5s, KHÔNG restart).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pairs = normPairs(body?.pairs);
    await writeFile(PAIR_WHITELIST_FILE, JSON.stringify({ include_pairs: pairs, updatedAt: new Date().toISOString() }, null, 2));
    return Response.json({ ok: true, pairs });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
