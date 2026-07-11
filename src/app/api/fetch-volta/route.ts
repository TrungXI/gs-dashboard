import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token: string };

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token' }, { status: 400 });
  }

  const url =
    'https://volui.sb21.net/volta-be-ui/api/v2/volta/history' +
    '?fromDate=&matchType=4&check-total=true&index=0&size=100&textSearch=&timezoneOffset=-420';

  const res = await fetch(url, {
    headers: {
      token,
      accept: 'application/json',
      lng: 'vi',
    },
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `API ${res.status}` }, { status: 502 });
  }

  let data = await res.json();
  if (typeof data === 'string') data = JSON.parse(data);

  const items: Record<string, unknown>[] = data['1'] ?? [];

  return NextResponse.json({ ok: true, data: items });
}
