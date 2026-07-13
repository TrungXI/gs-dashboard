import { NextResponse } from 'next/server';
import { fetchAllMatches } from '../../../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const matches = await fetchAllMatches();
    return NextResponse.json({ ok: true, matches });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
