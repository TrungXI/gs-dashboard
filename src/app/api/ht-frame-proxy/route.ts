import { NextRequest, NextResponse } from 'next/server';
import { issueSignedToken, presignUrl } from '@vercel/blob';

export const dynamic = 'force-dynamic';

const BLOB_HOST = 'blob.vercel-storage.com';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (!parsed.hostname.endsWith(BLOB_HOST)) {
    return NextResponse.json({ error: 'disallowed host' }, { status: 403 });
  }

  const pathname = parsed.pathname; // e.g. /ht-frames/5458679/00.jpg

  const signedToken = await issueSignedToken({
    pathname,
    operations: ['get'],
    validUntil: Date.now() + 3600 * 1000,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    pathname,
    operation: 'get',
    access: 'private',
  }) as { presignedUrl: string };

  return NextResponse.redirect(presignedUrl, { status: 302 });
}
