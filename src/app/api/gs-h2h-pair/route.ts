import { NextResponse } from 'next/server';
import { fetchH2HPair } from '../../../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

// GET /api/gs-h2h-pair?eventId=5458528
//   -> { ok, home, away, league, ft, h1 }
// Head-to-head Tài/Xỉu stats for the exact team pair of a live match, resolved
// from `eventId`. `ft` / `h1` are null when the pair has no gradable matches on
// that market. No ≥5-match threshold — the FE decides how to warn on small `n`.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const eventId = Number(searchParams.get('eventId'));
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid eventId' }, { status: 400 });
    }

    const pair = await fetchH2HPair(eventId);
    if (!pair.ok) {
      return NextResponse.json(pair, { status: 404 });
    }
    return NextResponse.json(pair);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
