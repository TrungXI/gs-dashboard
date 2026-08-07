import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WHITELIST_FILE = process.env.WHITELIST_FILE || '/opt/gs-collector/tx-paper/whitelist-r4d.json';
const DEFAULT = ['India', 'New Zealand', 'Iran', 'China', 'Qatar', 'Vietnam', 'Indonesia'];

// Whitelist ĐỘNG của 4 con Real (model R4D) — đọc từ file bot ghi (đổi qua Telegram /setwhitelist).
// R4D chỉ đánh trận có ≥1 đội trong list này. Thiếu file → trả DEFAULT (khớp mặc định trong bot).
export async function GET() {
  try {
    const raw = await readFile(WHITELIST_FILE, 'utf8');
    const arr = JSON.parse(raw).include;
    const include = Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim()).filter(Boolean) : DEFAULT;
    return Response.json({ ok: true, include });
  } catch {
    return Response.json({ ok: true, include: DEFAULT, fallback: true });
  }
}
