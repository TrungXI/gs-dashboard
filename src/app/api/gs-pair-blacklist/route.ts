import { readFile, writeFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAIR_BLACKLIST_FILE = process.env.PAIR_BLACKLIST_FILE || '/opt/gs-collector/tx-paper/pair-blacklist-r4d.json';

function normPairs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = input
    .map((p) => String(p).split('|').map((t) => t.trim()).filter(Boolean).sort().join('|'))
    .filter((p) => p.includes('|'));
  return [...new Set(out)];
}

// Pairing blacklist ĐỘNG của 4 con Real (model R4D) — đọc từ file bot ghi (đổi qua Telegram /setpairbl).
// Mỗi cặp lưu "A|B" (2 baseName sort lexicographic). R4D bỏ trận nếu cặp đấu nằm trong list.
// Thiếu file → trả rỗng (bot mặc định không né cặp nào).
export async function GET() {
  try {
    const raw = await readFile(PAIR_BLACKLIST_FILE, 'utf8');
    const arr = JSON.parse(raw).exclude_pairs;
    const pairs = Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    return Response.json({ ok: true, pairs });
  } catch {
    return Response.json({ ok: true, pairs: [], fallback: true });
  }
}

// SET pairing-blacklist — ghi file (reload ~5s, KHÔNG restart).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pairs = normPairs(body?.pairs);
    await writeFile(PAIR_BLACKLIST_FILE, JSON.stringify({ exclude_pairs: pairs, updatedAt: new Date().toISOString() }, null, 2));
    return Response.json({ ok: true, pairs });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
