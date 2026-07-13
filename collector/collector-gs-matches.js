'use strict'

require('dotenv').config()
const { Pool } = require('pg')

const GS_TOKEN = process.env.GS_TOKEN || '69-940214f0e803120fcfc9183ee4df89d5'
const POLL_MS  = 30 * 60 * 1000 // 30 minutes

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function vnTodayIso() {
  const ms = Date.now() + 7 * 60 * 60 * 1000
  const d  = new Date(ms)
  const yyyy = d.getUTCFullYear()
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function renameTeam(name) {
  return String(name).replace(/ \(V\)$/, ' (20p)').replace(/ \(S\)$/, ' (16p)')
}

async function fetchDay(date) {
  const headers = {
    token: GS_TOKEN,
    accept: 'application/json',
    lng: 'vi',
    'content-type': 'application/json',
  }
  const all   = []
  let index   = 0
  let total   = null

  while (true) {
    const url =
      `https://be.sb21.net/api/v2/matches/history` +
      `?index=${index}&size=50&fromDate=${date}&timezoneOffset=-420` +
      `&textSearch=&matchType=3&check-total=true`
    const res = await fetch(url, { headers })
    const raw = await res.text()
    if (!raw || raw.trim() === '' || raw.trim() === '""') break
    let d = JSON.parse(raw)
    if (typeof d === 'string') {
      if (!d || d.trim() === '') break
      d = JSON.parse(d)
    }
    if (total === null) total = Number(d['0'])
    const batch = d['1']
    if (!batch || !batch.length) break
    all.push(...batch)
    if (all.length >= total) break
    index += 1
  }
  return all
}

async function upsertMatches(matches) {
  let count = 0
  for (const m of matches) {
    const matchTime = m['0']
    const league    = String(m['1'] || '')
    const matchType = league.includes('20 minutes') ? '20p' : '16p'
    const homeTeam  = renameTeam(m['2'])
    const awayTeam  = renameTeam(m['3'])
    const h1Home    = parseInt(m['4'], 10) || 0
    const h1Away    = parseInt(m['5'], 10) || 0
    const ttHome    = parseInt(m['6'], 10) || 0
    const ttAway    = parseInt(m['7'], 10) || 0

    await pool.query(
      `INSERT INTO gs_matches_history
         (match_time, match_type, league, home_team, away_team, h1_home, h1_away, tt_home, tt_away)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (match_time, home_team, away_team) DO UPDATE SET
         h1_home    = EXCLUDED.h1_home,
         h1_away    = EXCLUDED.h1_away,
         tt_home    = EXCLUDED.tt_home,
         tt_away    = EXCLUDED.tt_away,
         updated_at = now()`,
      [matchTime, matchType, league, homeTeam, awayTeam, h1Home, h1Away, ttHome, ttAway]
    )
    count++
  }
  return count
}

async function poll() {
  const date = vnTodayIso()
  const ts   = new Date().toLocaleTimeString('vi-VN')
  console.log(`[${ts}] GS Matches — fetching ${date}`)
  try {
    const raw   = await fetchDay(date)
    const count = await upsertMatches(raw)
    console.log(`[${ts}] GS Matches — upserted ${count} rows`)
  } catch (e) {
    console.error(`[${ts}] GS Matches ERROR:`, e.message)
  }
}

console.log('GS Matches Collector started — polling every 30min')
console.log(`DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<hidden>@')}`)
poll()
setInterval(poll, POLL_MS)
