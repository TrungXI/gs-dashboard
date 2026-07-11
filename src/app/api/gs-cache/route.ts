import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

// GET: load all GS match data from Supabase
export async function GET() {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('gs_matches_cache')
      .select('date_key, matches, match_count, updated_at')
      .order('date_key', { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message });
    }

    // Convert to the format processData.ts expects: { matches20260627: [...], ... }
    const result: Record<string, unknown[]> = {};
    let latestUpdate = '';
    for (const row of data ?? []) {
      result[row.date_key] = row.matches as unknown[];
      if (row.updated_at > latestUpdate) latestUpdate = row.updated_at as string;
    }

    return NextResponse.json({ ok: true, data: result, updatedAt: latestUpdate, rowCount: data?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}

// POST: save GS match data to Supabase
// Body: { dateKey: 'matches20260627', matches: [...raw API items] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { dateKey: string; matches: unknown[] };
    const { dateKey, matches } = body;

    if (!dateKey || !Array.isArray(matches)) {
      return NextResponse.json({ ok: false, error: 'dateKey and matches required' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { error } = await db.from('gs_matches_cache').upsert({
      date_key: dateKey,
      matches: matches,
      match_count: matches.length,
      updated_at: new Date().toISOString(),
    });

    if (error) return NextResponse.json({ ok: false, error: error.message });
    return NextResponse.json({ ok: true, saved: matches.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
