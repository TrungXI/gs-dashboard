import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VPS_HOST = '103.82.23.48';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  if (parsed.hostname !== VPS_HOST || parsed.port !== '9999' || !parsed.pathname.startsWith('/frames/')) {
    return NextResponse.json({ error: 'disallowed' }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ error: `vps ${res.status}` }, { status: 502 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'content-type': res.headers.get('content-type') || 'image/jpeg',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
