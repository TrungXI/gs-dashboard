import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId');
  const token = req.nextUrl.searchParams.get('token');

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
          origin: 'https://det.zenandfe.com',
          referer: 'https://det.zenandfe.com/',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `getLiveLink ${res.status}` }, { status: 502 });
    }

    // API returns a double-encoded JSON string (the body is itself a JSON string).
    const raw = await res.json();
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { h5Link?: string; src?: string };
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
