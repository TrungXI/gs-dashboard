'use strict'

require('dotenv').config()
const { Pool } = require('pg')

const GS_TOKEN = process.env.GS_TOKEN || '69-aa116c3c7df75dbf33f2931adf208164'
const POLL_MS  = 2 * 60 * 1000 // 2 minutes

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

const VN_TO_EN = {
  'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
  'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Nga': 'Russia',
  'Đức': 'Germany', 'Pháp': 'France', 'Tây Ban Nha': 'Spain',
  'Bồ Đào Nha': 'Portugal', 'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium',
  'Thụy Sĩ': 'Switzerland(CHE)', 'Thụy Điển': 'Sweden', 'Na Uy': 'Norway',
  'Đan Mạch': 'Denmark', 'Ba Lan': 'Poland', 'Áo': 'Austria', 'Ý': 'Italy',
  'Anh': 'England', 'Maroc': 'Morocco', 'Mỹ': 'USA', 'Ả Rập Xê Út': 'Saudi Arabia',
  'Úc': 'Australia', 'Ấn Độ': 'India', 'Campuchia': 'Cambodia', 'Lào': 'Laos',
  'Viet Nam': 'Vietnam', 'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic', 'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea', 'IR Iran': 'Iran', 'Brunei Darussalam': 'Brunei',
}

function renameTeam(name) {
  const s = String(name).trim()
  const m = s.match(/^(.+?)(\s+\([VS]\))?$/)
  if (!m) return s
  const base = m[1].trim()
  const suffix = m[2]?.trim() ? ` ${m[2].trim()}` : ''
  return ((VN_TO_EN[base] ?? base) + suffix).trim()
}

/** Upsert team into gs_teams and return its id. Returns null if name has no (V)/(S) suffix. */
async function getOrCreateTeamId(name) {
  const m = name.match(/^(.+?)\s+\(([VS])\)$/)
  if (!m) return null
  const base = m[1].trim()
  const type = m[2]
  const { rows } = await pool.query(
    `INSERT INTO gs_teams (name, type) VALUES ($1, $2)
     ON CONFLICT (name, type) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [base, type]
  )
  return rows[0]?.id ?? null
}

// ── History collector ─────────────────────────────────────────────────────────

async function fetchDay(date) {
  const headers = {
    token: GS_TOKEN,
    accept: 'application/json',
    lng: 'en',
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
    const eventId   = typeof m['8'] === 'number' ? m['8'] : null

    const [homeTeamId, awayTeamId] = await Promise.all([
      getOrCreateTeamId(homeTeam),
      getOrCreateTeamId(awayTeam),
    ])

    await pool.query(
      `INSERT INTO gs_matches_history
         (match_time, match_type, league, home_team, away_team,
          h1_home, h1_away, tt_home, tt_away, event_id,
          home_team_id, away_team_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (match_time, home_team, away_team) DO UPDATE SET
         h1_home      = EXCLUDED.h1_home,
         h1_away      = EXCLUDED.h1_away,
         tt_home      = EXCLUDED.tt_home,
         tt_away      = EXCLUDED.tt_away,
         event_id     = COALESCE(gs_matches_history.event_id, EXCLUDED.event_id),
         home_team_id = COALESCE(gs_matches_history.home_team_id, EXCLUDED.home_team_id),
         away_team_id = COALESCE(gs_matches_history.away_team_id, EXCLUDED.away_team_id),
         updated_at   = now()`,
      [matchTime, matchType, league, homeTeam, awayTeam,
       h1Home, h1Away, ttHome, ttAway, eventId,
       homeTeamId, awayTeamId]
    )
    count++
  }
  return count
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

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

console.log('GS Matches Collector started — polling every 2min')
console.log(`DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<hidden>@')}`)
poll()
setInterval(poll, POLL_MS)
