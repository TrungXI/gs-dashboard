import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nhận ảnh chụp (client-side getDisplayMedia) qua multipart/form-data rồi gửi
// thẳng vào Telegram (sendPhoto). KHÔNG còn microservice chụp headless chromium.
const CHAT = process.env.VIDEO_SNAPSHOT_CHAT || '-1004383579942';
const THREAD = process.env.VIDEO_SNAPSHOT_THREAD || '1518';

export async function POST(req: Request) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'no token' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid form' }, { status: 400 });
  }

  const image = form.get('image');
  if (!(image instanceof Blob)) {
    return NextResponse.json({ ok: false, error: 'no image' }, { status: 400 });
  }

  const str = (k: string): string => {
    const v = form.get(k);
    return typeof v === 'string' ? v.trim() : '';
  };
  const homeTeam = str('homeTeam');
  const awayTeam = str('awayTeam');
  const h1Home = str('h1Home');
  const h1Away = str('h1Away');
  const leagueName = str('leagueName');
  const phase = str('phase');

  // Caption: ⚽ Nhà vs Khách · <tỉ số> · <phase> · <giải>, bỏ phần rỗng.
  let caption = `⚽ ${homeTeam} vs ${awayTeam}`;
  if (h1Home && h1Away) caption += ` · ${h1Home}-${h1Away}`;
  if (phase) caption += ` · ${phase}`;
  if (leagueName) caption += ` · ${leagueName}`;

  const tg = new FormData();
  tg.append('chat_id', CHAT);
  tg.append('message_thread_id', THREAD);
  tg.append('caption', caption);
  tg.append('photo', new Blob([await image.arrayBuffer()], { type: 'image/jpeg' }), 'shot.jpg');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: tg,
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (json.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false, error: json.description || 'telegram error' }, { status: 502 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }
}
