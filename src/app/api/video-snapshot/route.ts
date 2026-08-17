import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nhận ảnh (multipart) đã chụp CLIENT-SIDE từ trình duyệt → gửi thẳng lên Telegram
// (sendPhoto), KHÔNG còn microservice capture. Token bot đọc từ env, không hardcode.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid form' }, { status: 400 });
  }

  const image = form.get('image');
  if (!(image instanceof File)) {
    return NextResponse.json({ ok: false, error: 'no image' }, { status: 400 });
  }

  const token = process.env.TG_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw';
  if (!token) {
    return NextResponse.json({ ok: false, error: 'no token' }, { status: 500 });
  }

  const CHAT = process.env.VIDEO_SNAPSHOT_CHAT || '-1004383579942';
  const THREAD = process.env.VIDEO_SNAPSHOT_THREAD || '1518';

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

  // Caption: ⚽ home vs away · h1-h2 · phase · league (bỏ phần trống).
  const parts: string[] = [];
  if (homeTeam || awayTeam) parts.push(`⚽ ${homeTeam} vs ${awayTeam}`);
  if (h1Home && h1Away) parts.push(`${h1Home}-${h1Away}`);
  if (phase) parts.push(phase);
  if (leagueName) parts.push(leagueName);
  const caption = parts.join(' · ');

  try {
    const tg = new FormData();
    tg.append('chat_id', CHAT);
    tg.append('message_thread_id', THREAD);
    if (caption) tg.append('caption', caption);
    const blob = new Blob([await image.arrayBuffer()], { type: 'image/jpeg' });
    tg.append('photo', blob, 'shot.jpg');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: tg,
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (json && json.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { ok: false, error: (json && json.description) || `telegram ${res.status}` },
      { status: 502 },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  }
}
