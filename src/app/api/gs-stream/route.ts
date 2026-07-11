import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_TOKEN = '69-6aed7dc417eb4882d88c6899ae3c0ae1';

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId');
  const token = req.nextUrl.searchParams.get('token') ?? DEFAULT_TOKEN;

  if (!eventId) return NextResponse.json({ ok: false, error: 'eventId required' }, { status: 400 });

  const agentId = token.split('-')[0] ?? '69';

  try {
    const res = await fetch(
      `https://be.sb21.net/api/v2/getLiveLink?eventId=${eventId}&agentId=${agentId}&brand=`,
      {
        headers: {
          token,
          lng: 'vi',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `getLiveLink ${res.status}` }, { status: 502 });
    }

    const data = (await res.json()) as { h5Link?: string; src?: string };
    const h5Link = data.h5Link;

    if (!h5Link) {
      return NextResponse.json({ ok: false, error: 'no h5Link' }, { status: 502 });
    }

    // h5Link is like "STREAMKEY?type=m3u8&streaming=antmedia&token=..."
    const streamUrl = `https://www.glivestreaming.com/${h5Link}`;
    return NextResponse.json({ ok: true, streamUrl, src: 'gs' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
