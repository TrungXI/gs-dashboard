import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

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

  // Save to Supabase (fire-and-forget).
  // Raw Volta items key their id at ['10'] and ISO datetime at ['0'].
  if (items.length > 0) {
    const db = supabaseAdmin();
    const rows = items.map(item => ({
      match_id: Number(item['10'] ?? item['matchId'] ?? item['id'] ?? 0),
      match_data: item,
      match_date: String(item['0'] ?? item['date'] ?? ''),
      updated_at: new Date().toISOString(),
    })).filter(r => r.match_id > 0);

    db.from('volta_matches_cache').upsert(rows, { onConflict: 'match_id' })
      .then(({ error }) => {
        if (error) console.error('[volta-cache] upsert error:', error.message);
      });
  }

  return NextResponse.json({ ok: true, data: items });
}
