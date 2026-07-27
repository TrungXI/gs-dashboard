import { NextResponse } from 'next/server';
import { fetchLateGoalFeatured } from '../../../lib/gsMatchesDb';

// Heavy aggregate over the whole match_odds_log — recompute from the LIVE DB but
// cache the result for 15 min (ISR). Every 15 min the SQL re-runs, so the top-10
// featured pairs evolve automatically as new matches accumulate. Not a static
// snapshot: no force-static, no baked-in list.
export const revalidate = 900;

// GET /api/gs-late-goal-featured
//   -> { h1: [{t1,t2,pct,n}], h2: [{t1,t2,pct,n}] }
export async function GET() {
  try {
    const featured = await fetchLateGoalFeatured();
    return NextResponse.json(featured);
  } catch (e) {
    return NextResponse.json({ h1: [], h2: [], error: String(e) }, { status: 500 });
  }
}
