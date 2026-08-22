import { Pool } from 'pg';
import { syncTeamAnalyst } from '../../../../lib/teamAnalystSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/asians-analyst/sync — rebuild gs_asians_analyst FROM SCRATCH over a rolling 7-day
// window, for the "Giao hữu Châu Á" 16p league ONLY (match_type = '16p', league_id 2140).
// Mirror of /api/clbv-analyst/sync for the 16p league instead of 20p_club.
//
// 2026-08-22: source switched from match_odds_log JOIN gs_matches_history to gs_full_ticks —
// see src/lib/teamAnalystSync.ts for the methodology and why. Shared with
// /api/clbv-analyst/sync (identical schema/logic, only match_type + destination table differ).

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

export async function POST() {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' });

  try {
    const result = await syncTeamAnalyst(pool, { matchType: '16p', table: 'gs_asians_analyst' });
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) });
  }
}
