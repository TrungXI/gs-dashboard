import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Forward chụp ảnh sang microservice capture (headful Chrome dưới Xvfb trên VPS).
// Microservice tự chụp 10 frame + gửi Telegram; route này chỉ proxy JSON.
const CAPTURE_URL = process.env.MANUAL_CAPTURE_URL || 'http://127.0.0.1:9997/capture';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Service chụp 10 frame, mất ~25-35s → timeout rộng tay 50s.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'invalid capture response' }));
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
