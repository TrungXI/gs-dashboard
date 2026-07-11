import { NextRequest, NextResponse } from 'next/server';

async function fetchDay(
  token: string,
  date: string,
): Promise<{ total: number; matches: unknown[] }> {
  const headers = {
    token,
    accept: 'application/json',
    lng: 'vi',
    'content-type': 'application/json',
  };
  const all: unknown[] = [];
  let index = 0;
  let total: number | null = null;

  while (true) {
    const url =
      `https://be.sb21.net/api/v2/matches/history` +
      `?index=${index}&size=50&fromDate=${date}&timezoneOffset=-420` +
      `&textSearch=&matchType=3&check-total=true`;
    const res = await fetch(url, { headers });
    let d = JSON.parse(await res.text()) as unknown;
    if (typeof d === 'string') d = JSON.parse(d) as unknown;
    const obj = d as Record<string, unknown>;
    if (total === null) total = Number(obj['0']);
    const batch = obj['1'] as unknown[] | undefined;
    if (!batch?.length) break;
    all.push(...batch);
    if (all.length >= total) break;
    index += 1;
  }

  return { total: total ?? 0, matches: all };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; dates?: string[] };
    const { token, dates } = body;
    if (!token || !dates?.length) {
      return NextResponse.json({ error: 'token and dates required' }, { status: 400 });
    }

    const result: Record<string, unknown[]> = {};
    for (const date of dates) {
      const r = await fetchDay(token, date);
      result[date] = r.matches;
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
