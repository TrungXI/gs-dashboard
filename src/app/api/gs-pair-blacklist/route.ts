import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAIR_BLACKLIST_FILE = process.env.PAIR_BLACKLIST_FILE || '/opt/gs-collector/tx-paper/pair-blacklist-r4d.json';

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
