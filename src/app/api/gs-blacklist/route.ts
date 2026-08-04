import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLACKLIST_FILE = process.env.BLACKLIST_FILE || '/opt/gs-collector/tx-paper/blacklist-real.json';
const DEFAULT = ['Indonesia', 'Saudi Arabia', 'North Korea'];

// Blacklist ĐỘNG của 4 con Real — đọc từ file bot ghi (đổi qua Telegram /setblacklist).
// Thiếu file → trả DEFAULT (khớp mặc định trong bot).
export async function GET() {
  try {
    const raw = await readFile(BLACKLIST_FILE, 'utf8');
    const arr = JSON.parse(raw).exclude;
    const exclude = Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim()).filter(Boolean) : DEFAULT;
    return Response.json({ ok: true, exclude });
  } catch {
    return Response.json({ ok: true, exclude: DEFAULT, fallback: true });
  }
}
