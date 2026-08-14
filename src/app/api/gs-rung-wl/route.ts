import { readFile } from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAI_FILE = process.env.RUNG_TAI_WL_FILE || '/opt/gs-collector/tx-paper/rung-tai-whitelist.json';
const XIU_FILE = process.env.RUNG_XIU_WL_FILE || '/opt/gs-collector/tx-paper/rung-xiu-whitelist.json';

async function load(f: string): Promise<string[]> {
  try {
    const arr = JSON.parse(await readFile(f, 'utf8')).include_pairs;
    return Array.isArray(arr) ? arr.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 2 list ĐỘNG của V.Bot 18 (job 3h sáng sinh): rung-tai (cặp nổ chậm → TÀI phút 34) +
// rung-xiu (cặp tịt → XỈU phút 29). CHỈ ĐỌC — cặp "A|B" (2 baseName sort). Dùng cho badge RankingLive.
export async function GET() {
  const [tai, xiu] = await Promise.all([load(TAI_FILE), load(XIU_FILE)]);
  return Response.json({ ok: true, tai, xiu });
}
