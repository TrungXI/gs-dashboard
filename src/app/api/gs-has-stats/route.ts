import { NextRequest } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ANALYSIS_DATABASE_URL = process.env.ANALYSIS_DATABASE_URL;

// Lazy pool — only created when DB URL is set
let _pool: Pool | null = null;
function getPool(): Pool | null {
  if (!ANALYSIS_DATABASE_URL) return null;
  if (!_pool) _pool = new Pool({ connectionString: ANALYSIS_DATABASE_URL, max: 3 });
  return _pool;
}

// Trận "đã có chỉ số H1": tồn tại row trong gs_ht_stats cho eventId đó
// (ảnh hiệp 1 đã chụp + OCR thành công → panel "Chỉ số H1" có số).
export interface GsHasStatsResponse {
  ok: boolean;
  error?: string;
  eventIds?: number[]; // chỉ những eventId có row trong gs_ht_stats
}

export async function GET(req: NextRequest) {
  const pool = getPool();
  if (!pool) return Response.json({ ok: false, error: 'no db' } satisfies GsHasStatsResponse);

  const eventIds = (req.nextUrl.searchParams.get('eventIds') ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (eventIds.length === 0) return Response.json({ ok: true, eventIds: [] } satisfies GsHasStatsResponse);

  try {
    const res = await pool.query<{ event_id: number }>(
      `SELECT event_id FROM gs_ht_stats WHERE event_id = ANY($1::bigint[])`,
      [eventIds],
    );
    return Response.json({
      ok: true,
      eventIds: res.rows.map((r) => Number(r.event_id)),
    } satisfies GsHasStatsResponse);
  } catch (e) {
    return Response.json({ ok: false, error: String(e) } satisfies GsHasStatsResponse);
  }
}
