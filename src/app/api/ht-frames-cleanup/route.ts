import { NextRequest, NextResponse } from 'next/server';
import { list, del } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== 'gs-cleanup-2025') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const deleted: string[] = [];
  let cursor: string | undefined;

  do {
    const result = await list({ prefix: 'ht-frames/', cursor, limit: 100 });
    if (result.blobs.length > 0) {
      const urls = result.blobs.map(b => b.url);
      await del(urls);
      deleted.push(...urls);
    }
    cursor = result.cursor;
  } while (cursor);

  return NextResponse.json({ deleted: deleted.length, files: deleted });
}
