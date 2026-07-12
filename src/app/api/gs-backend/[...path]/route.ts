import { NextRequest } from 'next/server';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

async function proxy(req: NextRequest, pathParts: string[]) {
  const path = pathParts.join('/');
  const search = req.nextUrl.search;
  const upstream = `https://be.sb21.net/${path}${search}`;

  const forwardHeaders: Record<string, string> = {
    Origin: 'https://zenandfe.com',
    Referer: 'https://zenandfe.com/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  for (const h of ['token', 'lng', 'content-type', 'accept']) {
    const v = req.headers.get(h);
    if (v) forwardHeaders[h] = v;
  }

  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.arrayBuffer() : undefined;

  const res = await fetch(upstream, {
    method: req.method,
    headers: forwardHeaders,
    body: body ?? undefined,
    cache: 'no-store',
  });

  const data = await res.arrayBuffer();
  return new Response(data, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      ...CORS,
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
