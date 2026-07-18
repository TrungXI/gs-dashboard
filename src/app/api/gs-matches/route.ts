import { NextResponse } from 'next/server';
import {
  fetchMatchesPage,
  fetchMatchFilterOptions,
} from '../../../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

// GET /api/gs-matches?type=all&date=all&team=all&limit=50&offset=0[&options=1]
//   -> { ok, matches, total, options? }
// `type`   : all | 20p | 16p
// `date`   : all | YYYY-MM-DD
// `team`   : all | display name (e.g. "Barcelona (S)")
// `limit`  : page size (default 50)
// `offset` : page offset (default 0)
// `options`: when "1", also returns the filter option lists (dates/teams/counts).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const type = searchParams.get('type') ?? 'all';
    const date = searchParams.get('date') ?? 'all';
    const team = searchParams.get('team') ?? 'all';
    const limit = Number(searchParams.get('limit') ?? '50') || 50;
    const offset = Number(searchParams.get('offset') ?? '0') || 0;
    const wantOptions = searchParams.get('options') === '1';

    const [page, options] = await Promise.all([
      fetchMatchesPage({ type, date, team, limit, offset }),
      wantOptions ? fetchMatchFilterOptions() : Promise.resolve(undefined),
    ]);

    return NextResponse.json({
      ok: true,
      matches: page.matches,
      total: page.total,
      ...(options ? { options } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
