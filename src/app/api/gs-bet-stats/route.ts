import { NextResponse } from 'next/server';
import { fetchBetStatsPage, fetchMatchFilterOptions } from '../../../lib/gsMatchesDb';

export const dynamic = 'force-dynamic';

// GET /api/gs-bet-stats?type=all&date=all&team=all&team2=all&weekday=all&limit=50&offset=0[&options=1]
//   -> { ok, rows, total, summary, options? }
// `type`    : all | 20p | 16p
// `date`    : all | YYYY-MM-DD
// `team`    : all | display name (e.g. "Barcelona (S)")
// `team2`   : all | display name — with `team`, restricts to their head-to-head matches
// `weekday` : all | 1..7 (Bangkok ISO weekday, 1=Mon .. 7=Sun)
// `limit`   : page size (default 50)
// `offset`  : page offset (default 0)
// `options` : when "1", also returns the filter option lists (dates/teams/counts).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const type = searchParams.get('type') ?? 'all';
    const date = searchParams.get('date') ?? 'all';
    const team = searchParams.get('team') ?? 'all';
    const team2 = searchParams.get('team2') ?? 'all';
    const weekday = searchParams.get('weekday') ?? 'all';
    const limit = Number(searchParams.get('limit') ?? '50') || 50;
    const offset = Number(searchParams.get('offset') ?? '0') || 0;
    const wantOptions = searchParams.get('options') === '1';

    const [page, options] = await Promise.all([
      fetchBetStatsPage({ type, date, team, team2, weekday, limit, offset }),
      wantOptions ? fetchMatchFilterOptions() : Promise.resolve(undefined),
    ]);

    return NextResponse.json({
      ok: true,
      rows: page.rows,
      total: page.total,
      summary: page.summary,
      ...(options ? { options } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
