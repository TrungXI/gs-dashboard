import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { put } from '@vercel/blob';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let pool: Pool | null = null;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.ANALYSIS_DATABASE_URL });
  return pool;
}

const FRAME_INTERVAL_MS = 4000;
const TOTAL_FRAMES      = 5;

const CHROMIUM_BIN  = join(tmpdir(), 'chromium');
const CHROMIUM_PACK = join(tmpdir(), 'chromium-pack');
const CHROMIUM_SRC  = process.env.CHROMIUM_SRC_URL || 'http://103.82.23.48:9999/chromium-v149-pack.tar';

async function getChromiumPath(): Promise<string> {
  const chromium = (await import('@sparticuz/chromium')).default;

  // Already extracted in this container — reuse
  if (existsSync(CHROMIUM_BIN)) return CHROMIUM_BIN;

  // Stream download directly into tar extraction (same logic as @sparticuz/chromium's downloadAndExtract
  // but using HTTP so we bypass its isValidUrl which only allows https://)
  const { extract } = await import('tar-fs');
  const res = await fetch(CHROMIUM_SRC, { redirect: 'follow', signal: AbortSignal.timeout(50_000) });
  if (!res.ok || !res.body) throw new Error(`Chromium fetch ${res.status}`);

  try {
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), extract(CHROMIUM_PACK));
  } catch (e) {
    await rm(CHROMIUM_PACK, { force: true, recursive: true }).catch(() => {});
    throw e;
  }

  return chromium.executablePath(CHROMIUM_PACK);
}

export async function POST(req: NextRequest) {
  const { eventId, homeTeam, awayTeam, h1Home, h1Away, token } = await req.json();

  if (!eventId || !token) {
    return NextResponse.json({ ok: false, error: 'missing eventId or token' }, { status: 400 });
  }

  const videoUrl =
    `https://det.zenandfe.com/?token=${token}&agentId=69&lng=vi&sportId=1&route=3&eventId=${eventId}&brand=`;

  const puppeteer = (await import('puppeteer-core')).default;
  const chromium  = (await import('@sparticuz/chromium')).default;

  let browser;
  try {
    const db = getPool();
    await db.query(
      `INSERT INTO gs_ht_events (event_id, home_team, away_team, h1_home, h1_away, video_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (event_id) DO UPDATE SET triggered_at = now(), video_url = EXCLUDED.video_url`,
      [eventId, homeTeam, awayTeam, h1Home ?? 0, h1Away ?? 0, videoUrl]
    );

    const executablePath = await getChromiumPath();
    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: { width: 1280, height: 720 },
      executablePath,
      headless:        true,
    });

    const page = await browser.newPage();
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    const uploads: Promise<void>[] = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      await new Promise(r => setTimeout(r, FRAME_INTERVAL_MS));
      const buf        = await page.screenshot({ type: 'jpeg', quality: 75 }) as Buffer;
      const filename   = `ht-frames/${eventId}/${String(i).padStart(2, '0')}.jpg`;
      const frameIndex = i;
      uploads.push(
        put(filename, buf, { access: 'private', allowOverwrite: true }).then(blob => {
          const proxyUrl = `https://gs-dashboard-two.vercel.app/api/ht-frame-proxy?url=${encodeURIComponent(blob.url)}`;
          return db.query(
            `INSERT INTO gs_ht_frames (event_id, frame_index, frame_url, video_url)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (event_id, frame_index) DO UPDATE SET frame_url = EXCLUDED.frame_url, video_url = EXCLUDED.video_url`,
            [eventId, frameIndex, proxyUrl, videoUrl]
          );
        }).then(() => undefined)
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
