import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

// Raw Volta API items key their fields numerically: id at ['10'], ISO datetime at ['0'].
// Fall back to matchId/id/date in case an already-processed VoltaMatch is ever sent.
function extractMatchId(item: Record<string, unknown>): number {
  return Number(item['10'] ?? item['matchId'] ?? item['id'] ?? 0);
}

function extractMatchDate(item: Record<string, unknown>): string {
  return String(item['0'] ?? item['date'] ?? '');
}

// GET: load all Volta matches from Supabase
export async function GET() {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('volta_matches_cache')
      .select('match_id, match_data, match_date, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    const items = (data ?? []).map(row => row.match_data);
    const latestUpdate = (data ?? [])[0]?.updated_at ?? '';

    return NextResponse.json({
      ok: true,
      data: items,
      total: items.length,
      updatedAt: latestUpdate,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}

// POST: merge new Volta matches into Supabase
// Body: { items: [...raw API items] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { items: Record<string, unknown>[] };
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: 'items array required' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const rows = items.map(item => ({
      match_id: extractMatchId(item),
      match_data: item,
      match_date: extractMatchDate(item),
      updated_at: new Date().toISOString(),
    })).filter(r => r.match_id > 0);

    const { error } = await db.from('volta_matches_cache').upsert(rows, {
      onConflict: 'match_id',
    });

    if (error) return NextResponse.json({ ok: false, error: error.message });
    return NextResponse.json({ ok: true, saved: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
