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

const FRAME_INTERVAL_MS = 2000;
const TOTAL_FRAMES      = 20; // 2s × 20 = 40s

export async function POST(req: NextRequest) {
  const { eventId, homeTeam, awayTeam, h1Home, h1Away, token } = await req.json();

  if (!eventId || !token) {
    return NextResponse.json({ ok: false, error: 'missing eventId or token' }, { status: 400 });
  }

  const videoUrl =
    `https://m.zenandfe.com/?agentId=69&token=${token}` +
    `&loginUrl=https%3A%2F%2Fhdbet.pub%2F%3Fmodal%3DLOGIN` +
    `&registerUrl=https%3A%2F%2Fhdbet.pub%2F%3Fmodal%3DSIGN_UP` +
    `&sportId=1&eventId=${eventId}`;

  // Dynamic import to avoid build issues
  const chromium    = (await import('@sparticuz/chromium')).default;
  const puppeteer   = (await import('puppeteer-core')).default;

  let browser;
  try {
    // Upsert event row
    const db = getPool();
    await db.query(
      `INSERT INTO gs_ht_events (event_id, home_team, away_team, h1_home, h1_away)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (event_id) DO UPDATE SET triggered_at = now()`,
      [eventId, homeTeam, awayTeam, h1Home ?? 0, h1Away ?? 0]
    );

    browser = await puppeteer.launch({
      args:             chromium.args,
      defaultViewport:  { width: 1280, height: 720 },
      executablePath:   await chromium.executablePath(),
      headless:         true,
    });

    const page = await browser.newPage();
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Take TOTAL_FRAMES screenshots, one every FRAME_INTERVAL_MS
    const uploads: Promise<void>[] = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      await new Promise(r => setTimeout(r, FRAME_INTERVAL_MS));
      const buf      = await page.screenshot({ type: 'jpeg', quality: 75 }) as Buffer;
      const filename = `ht-frames/${eventId}/${String(i).padStart(2, '0')}.jpg`;

      // Upload each frame to Vercel Blob + save URL to DB (fire-and-forget within request)
      const frameIndex = i;
      uploads.push(
        put(filename, buf, { access: 'public' }).then(blob =>
          db.query(
            `INSERT INTO gs_ht_frames (event_id, frame_index, frame_url)
             VALUES ($1,$2,$3)
             ON CONFLICT (event_id, frame_index) DO UPDATE SET frame_url = EXCLUDED.frame_url`,
            [eventId, frameIndex, blob.url]
          )
        ).then(() => undefined)
      );
    }

    await Promise.all(uploads);
    return NextResponse.json({ ok: true, eventId, frames: TOTAL_FRAMES });

  } catch (e) {
    console.error('[HT-CAPTURE]', String(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}
