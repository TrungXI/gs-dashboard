'use strict'
 require('dns').setDefaultResultOrder('ipv4first')
require('net').setDefaultAutoSelectFamily(false)

require('dotenv').config()
const http     = require('http')
const { Pool } = require('pg')
const puppeteer = require('puppeteer-core')
const fs       = require('fs')
const path     = require('path')

let activeCaptures = 0
const MAX_CONCURRENT = 2
const captureQueue = []

async function runWithLimit(fn) {
  if (activeCaptures < MAX_CONCURRENT) {
    activeCaptures++
    try { return await fn() }
    finally {
      activeCaptures--
      if (captureQueue.length > 0) {
        const next = captureQueue.shift()
        next()
      }
    }
  }
  return new Promise((resolve, reject) => {
    captureQueue.push(async () => {
      activeCaptures++
      try { resolve(await fn()) }
      catch (e) { reject(e) }
      finally {
        activeCaptures--
        if (captureQueue.length > 0) {
          const next = captureQueue.shift()
          next()
        }
      }
    })
  })
}

const PORT         = 9998
const FRAMES_DIR   = path.join(__dirname, 'frames')
const DB_URL       = process.env.DATABASE_URL
const VERCEL_PROXY = 'https://gs-dashboard-two.vercel.app/api/ht-frame-proxy'
const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw'
const TG_CHAT = process.env.TELEGRAM_NOTIFY_CHAT || process.env.TELEGRAM_CHAT_ID || "738682531"

const pool = new Pool({ connectionString: DB_URL })

fs.mkdirSync(FRAMES_DIR, { recursive: true })

const CHROMIUM_BIN = '/opt/gs-collector/.browsers/chromium-1228/chrome-linux64/chrome'

function findChromium() {
  if (fs.existsSync(CHROMIUM_BIN)) return CHROMIUM_BIN
  throw new Error(`Chromium not found at ${CHROMIUM_BIN}`)
}

// --- Telegram helpers ---

async function tgSendMessage(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  })
}

async function tgSendPhotoGroup(filePaths) {
  const form = new FormData()
  form.append('chat_id', TG_CHAT)
  const media = filePaths.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }))
  form.append('media', JSON.stringify(media))
  for (let i = 0; i < filePaths.length; i++) {
    const buf = fs.readFileSync(filePaths[i])
    form.append(`f${i}`, new Blob([buf], { type: 'image/jpeg' }), `frame${i}.jpg`)
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMediaGroup`, {
    method: 'POST', body: form,
  })
  if (!res.ok) {
    const t = await res.text()
    console.error(`[TG] sendMediaGroup failed ${res.status}: ${t}`)
  }
}

async function notifyTelegram(eventId, homeTeam, awayTeam, h1Home, h1Away, eventDir) {
  try {
    await tgSendMessage('=========================')
    await tgSendMessage(
      `⚽ <b>${homeTeam} vs ${awayTeam}</b>\n` +
      `Kết thúc H1: <b>${h1Home ?? 0} - ${h1Away ?? 0}</b>\n` +
      `📸 Đang gửi ảnh hiệp 1...`
    )

    const frames = Array.from({ length: 10 }, (_, i) =>
      path.join(eventDir, String(i).padStart(2, '0') + '.jpg')
    ).filter(p => fs.existsSync(p))

    // Telegram sendMediaGroup max 10/batch
    for (let b = 0; b < Math.ceil(frames.length / 10); b++) {
      const batch = frames.slice(b * 10, b * 10 + 10)
      if (batch.length) await tgSendPhotoGroup(batch)
    }
    console.log(`[TG] notified eventId=${eventId} (${frames.length} frames)`)
  } catch (e) {
    console.error(`[TG] notify error: ${e.message}`)
  }
}

// --- Capture ---

async function captureMatch(payload) {
  const TIMEOUT_MS = 150_000
  return Promise.race([
    _captureMatch(payload),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('capture timeout 150s')), TIMEOUT_MS)
    )
  ])
}

async function _captureMatch({ eventId, homeTeam, awayTeam, h1Home, h1Away, token }) {
  const videoUrl = `https://det.zenandfe.com/?token=${token}&agentId=69&lng=vi&sportId=1&route=3&eventId=${eventId}&brand=`
  const executablePath = findChromium()
  const eventDir = path.join(FRAMES_DIR, String(eventId))
  fs.mkdirSync(eventDir, { recursive: true })

  await pool.query(
    `INSERT INTO gs_ht_events (event_id, home_team, away_team, h1_home, h1_away, video_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (event_id) DO UPDATE SET triggered_at=now(), video_url=EXCLUDED.video_url`,
    [eventId, homeTeam, awayTeam, h1Home ?? 0, h1Away ?? 0, videoUrl]
  )

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
      ],
      defaultViewport: { width: 1280, height: 720 },
    })

    const page = await browser.newPage()
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})

    const TOTAL     = 10
    const INTERVAL  = 6000
    const MIN_SIZE  = 55_000 // bytes — blank/loading screens are ~40KB, stats screens ~62KB+

    for (let i = 0; i < TOTAL; i++) {
      await new Promise(r => setTimeout(r, INTERVAL))
      const imgPath  = path.join(eventDir, String(i).padStart(2, '0') + '.jpg')
      await page.screenshot({ path: imgPath, type: 'jpeg', quality: 75 })

      const size = fs.statSync(imgPath).size
      if (size < MIN_SIZE) {
        fs.unlinkSync(imgPath)
        console.log(`[CAPTURE] ${eventId} shot ${i + 1}/10 skipped (blank, ${size}B)`)
        continue
      }

      const vpsUrl   = `http://103.82.23.48:9999/frames/${eventId}/${String(i).padStart(2, '0')}.jpg`
      const proxyUrl = `${VERCEL_PROXY}?url=${encodeURIComponent(vpsUrl)}`

      await pool.query(
        `INSERT INTO gs_ht_frames (event_id, frame_index, frame_url, video_url)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (event_id, frame_index) DO UPDATE SET frame_url=EXCLUDED.frame_url, video_url=EXCLUDED.video_url`,
        [eventId, i, proxyUrl, videoUrl]
      )
      console.log(`[CAPTURE] ${eventId} shot ${i + 1}/10 saved (${size}B)`)
    }

    // Fire-and-forget — không block response
    notifyTelegram(eventId, homeTeam, awayTeam, h1Home, h1Away, eventDir).catch(() => {})

    return { ok: true, frames: TOTAL }
  } finally {
    if (browser) {
      try { await browser.close() } catch { browser.process()?.kill('SIGKILL') }
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/capture') {
    res.writeHead(404); res.end('not found'); return
  }

  let body = ''
  req.on('data', d => body += d)
  req.on('end', async () => {
    try {
      const data = JSON.parse(body)
      console.log(`[CAPTURE] start eventId=${data.eventId}`)
      const result = await runWithLimit(() => captureMatch(data))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      console.error(`[CAPTURE] error: ${e.message}`)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }
  })
})

server.listen(PORT, () => console.log(`GS Capture service running on :${PORT}`))
