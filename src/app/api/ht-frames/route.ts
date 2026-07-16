import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const dynamic = 'force-dynamic';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('eventId') ?? '';
  if (!eventId)
    return NextResponse.json({ ok: false, error: 'missing eventId' }, { status: 400 });

  try {
    const db = getPool();
    const { rows } = await db.query<{ frame_index: number; frame_url: string; video_url: string }>(
      `SELECT frame_index, frame_url, video_url
       FROM gs_ht_frames
       WHERE event_id = $1
       ORDER BY frame_index ASC`,
      [eventId],
    );

    const frames = rows.map((r) => ({
      frame_index: r.frame_index,
      frame_url: r.frame_url,
      video_url: r.video_url,
    }));

    return NextResponse.json({ frames });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
