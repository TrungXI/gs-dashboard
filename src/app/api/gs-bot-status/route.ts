import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pexec = promisify(exec);

// pm2 process name → calc_version. Dùng cho bot hardcode CALC_VERSION trong .mjs.
// Bot đặt CALC_VERSION qua env (vbot13/14) tự đọc từ pm2_env — map này chỉ là fallback.
const NAME_MAP: Record<string, string> = {
  'gs-vbot12real': 'V.Bot 12 Real',
  'gs-vbot12real-kien': 'V.Bot 12 Kien',
  'gs-vbot12real-trong': 'V.Bot 12 Trong',
  'gs-vbot12real-nam': 'V.Bot 12 Nam',
  'gs-vbot12': 'V.Bot 12',
  'gs-vbot12r1': 'V.Bot 12 R1',
  'gs-vbot12r4': 'V.Bot 12 R4-B',
  'gs-vbot12r4c': 'V.Bot 12 R4-C',
  'gs-vbot13r1': 'V.Bot 13 R1',
  'gs-vbot13r2': 'V.Bot 13 R2',
  'gs-vbot13r3': 'V.Bot 13 R3',
  'gs-vbot14': 'V.Bot 14',
  'gs-vbot1': 'V.Bot 1',
  'gs-vbot2': 'V.Bot 2',
  'gs-vbot5': 'V.Bot 5',
  'gs-vbot7': 'V.Bot 7',
  'gs-vbot8': 'V.Bot 8',
  'gs-vbot9': 'V.Bot 9',
  'gs-vbot10': 'V.Bot 10',
  'gs-vbot11': 'V.Bot 11',
  'gs-tai-xiu-live': 'Tài Xỉu Live',
  'gs-tx-paper-v8-drift': 'TX v8.0 · lineDrift',
  'gs-vbot21-qt-xiu': 'V.Bot 21 QT Xỉu',
  'gs-vbot-air1': 'V.Bot Air 1',
};

// pm2 process → NHIỀU calc_version (1 process chạy nhiều model). gs-hcap-paper chạy cả 3
// model handicap → 3 render key hcap:A/B/C (khớp `calcVersion` trong gs-bot-report BOTS).
const MULTI_NAME_MAP: Record<string, string[]> = {
  'gs-hcap-paper': ['hcap:A', 'hcap:B', 'hcap:C'],
};

interface Pm2Proc {
  name: string;
  pm2_env?: { status?: string; CALC_VERSION?: string };
}

// Trả danh sách calc_version của các bot ĐANG chạy (pm2 status = online).
// Lỗi (không gọi được pm2) → ok:false, running:[] → FE fallback hiện full (không ẩn nhầm).
export async function GET() {
  try {
    const { stdout } = await pexec('pm2 jlist', { maxBuffer: 8 * 1024 * 1024, timeout: 8000 });
    const list = JSON.parse(stdout) as Pm2Proc[];
    const running = new Set<string>();
    for (const p of list) {
      if (p.pm2_env?.status !== 'online') continue;
      // Multi-model process (gs-hcap-paper → 3 model): bỏ qua CALC_VERSION đơn của process.
      const multi = MULTI_NAME_MAP[p.name];
      if (multi) {
        for (const cv of multi) running.add(cv);
        continue;
      }
      const cv = p.pm2_env?.CALC_VERSION || NAME_MAP[p.name];
      if (cv) running.add(cv);
    }
    return Response.json({ ok: true, running: [...running] });
  } catch (e) {
    return Response.json({ ok: false, running: [], error: String(e) });
  }
}
