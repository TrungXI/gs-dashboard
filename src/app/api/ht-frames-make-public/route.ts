import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

// One-time migration: re-upload all private blob frames as public and update DB
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.MIGRATION_SECRET && secret !== 'gs-migrate-2025') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: 'no blob token' }, { status: 500 });

  const db = getPool();
  const { rows } = await db.query<{ event_id: number; frame_index: number; frame_url: string }>(
    `SELECT event_id, frame_index, frame_url FROM gs_ht_frames ORDER BY event_id, frame_index`
  );

  const results: { eventId: number; frameIndex: number; old: string; new: string; status: string }[] = [];

  for (const row of rows) {
    try {
      // Download private blob with token
      const res = await fetch(row.frame_url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        results.push({ eventId: row.event_id, frameIndex: row.frame_index, old: row.frame_url, new: '', status: `fetch_${res.status}` });
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      const filename = `ht-frames/${row.event_id}/${String(row.frame_index).padStart(2, '0')}.jpg`;

      const blob = await put(filename, buf, { access: 'public', allowOverwrite: true });

      await db.query(
        `UPDATE gs_ht_frames SET frame_url = $1 WHERE event_id = $2 AND frame_index = $3`,
        [blob.url, row.event_id, row.frame_index]
      );

      results.push({ eventId: row.event_id, frameIndex: row.frame_index, old: row.frame_url, new: blob.url, status: 'ok' });
    } catch (e) {
      results.push({ eventId: row.event_id, frameIndex: row.frame_index, old: row.frame_url, new: '', status: `error: ${String(e)}` });
    }
  }

  const ok    = results.filter(r => r.status === 'ok').length;
  const fail  = results.filter(r => r.status !== 'ok').length;
  return NextResponse.json({ total: rows.length, ok, fail, results });
}
