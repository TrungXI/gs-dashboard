'use strict'

require('dotenv').config()
const { Pool } = require('pg')

const GS_TOKEN = process.env.GS_TOKEN || '69-940214f0e803120fcfc9183ee4df89d5'
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
}

function renameTeam(name) {
  const s = String(name)
  const m = s.match(/^(.+?)(\s+\([VS]\))?$/)
  if (!m) return s
  const base = m[1].trim()
  const suffix = m[2] ?? ''
  return (VN_TO_EN[base] ?? base) + suffix
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

// ── Live odds logger ──────────────────────────────────────────────────────────

async function fetchLive() {
  const headers = {
    token: GS_TOKEN,
    accept: 'application/json',
    lng: 'en',
    'content-type': 'application/json',
  }
  const url = 'https://be.sb21.net/api/v2/matches/live?matchType=3&timezoneOffset=-420'
  const res = await fetch(url, { headers })
  const raw = await res.text()
  if (!raw || raw.trim() === '' || raw.trim() === '""') return []
  let d = JSON.parse(raw)
  if (typeof d === 'string') d = JSON.parse(d)
  // Live response: array or object with '1' key
  if (Array.isArray(d)) return d
  if (d && Array.isArray(d['1'])) return d['1']
  return []
}

function parseOddsLine(arr) {
  // arr: [line, homeOdds, awayOdds] or similar
  if (!arr || !arr.length) return { line: null, homeOdds: null, awayOdds: null }
  return {
    line:     arr[0] != null ? parseFloat(arr[0]) : null,
    homeOdds: arr[1] != null ? parseFloat(arr[1]) : null,
    awayOdds: arr[2] != null ? parseFloat(arr[2]) : null,
  }
}

function parseOuLine(arr) {
  if (!arr || !arr.length) return { line: null, overOdds: null, underOdds: null }
  return {
    line:      arr[0] != null ? parseFloat(arr[0]) : null,
    overOdds:  arr[1] != null ? parseFloat(arr[1]) : null,
    underOdds: arr[2] != null ? parseFloat(arr[2]) : null,
  }
}

async function logLiveOdds(events) {
  let count = 0
  for (const ev of events) {
    try {
      const eventId  = ev['0'] || ev['id'] || null
      const league   = String(ev['1'] || ev['league'] || '')
      const homeTeam = renameTeam(ev['2'] || ev['home'] || '')
      const awayTeam = renameTeam(ev['3'] || ev['away'] || '')
      const matchType = league.includes('20 minutes') ? '20p' : '16p'

      // Score fields — layout varies; try common keys
      const scoreHome = parseInt(ev['4'] ?? ev['scoreHome'] ?? 0, 10) || 0
      const scoreAway = parseInt(ev['5'] ?? ev['scoreAway'] ?? 0, 10) || 0
      const h1Home    = parseInt(ev['6'] ?? ev['h1Home'] ?? 0, 10) || 0
      const h1Away    = parseInt(ev['7'] ?? ev['h1Away'] ?? 0, 10) || 0

      // Period / minute
      const period  = parseInt(ev['period'] ?? ev['8'] ?? 0, 10) || 0
      const isH2    = period >= 2
      const minute  = parseInt(ev['minuteElapsed'] ?? ev['minute'] ?? ev['9'] ?? 0, 10) || 0

      // Cards / corners
      const yellowHome  = parseInt(ev['yellowHome']  ?? ev['yh'] ?? 0, 10) || 0
      const yellowAway  = parseInt(ev['yellowAway']  ?? ev['ya'] ?? 0, 10) || 0
      const redHome     = parseInt(ev['redHome']     ?? ev['rh'] ?? 0, 10) || 0
      const redAway     = parseInt(ev['redAway']     ?? ev['ra'] ?? 0, 10) || 0
      const cornersHome = parseInt(ev['cornersHome'] ?? ev['ch'] ?? 0, 10) || 0
      const cornersAway = parseInt(ev['cornersAway'] ?? ev['ca'] ?? 0, 10) || 0

      // Odds — try nested arrays or flat fields
      const hcArr  = ev['hcLines']?.[0] || ev['hc']  || null
      const ouArr  = ev['ouLines']?.[0] || ev['ou']  || null
      const hc = hcArr ? (Array.isArray(hcArr) ? parseOddsLine(hcArr) : { line: parseFloat(hcArr['line'] ?? 0), homeOdds: parseFloat(hcArr['home'] ?? 0), awayOdds: parseFloat(hcArr['away'] ?? 0) }) : { line: null, homeOdds: null, awayOdds: null }
      const ou = ouArr ? (Array.isArray(ouArr) ? parseOuLine(ouArr)   : { line: parseFloat(ouArr['line'] ?? 0), overOdds: parseFloat(ouArr['over'] ?? 0), underOdds: parseFloat(ouArr['under'] ?? 0) }) : { line: null, overOdds: null, underOdds: null }

      if (!homeTeam || !awayTeam) continue

      await pool.query(
        `INSERT INTO gs_match_odds_log
           (event_id, home_team, away_team, match_type,
            h1_home, h1_away, score_home, score_away,
            is_h2, minute_elapsed,
            hc_line, hc_home_odds, hc_away_odds,
            ou_line, ou_over_odds, ou_under_odds,
            yellow_home, yellow_away, red_home, red_away,
            corners_home, corners_away)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          eventId, homeTeam, awayTeam, matchType,
          h1Home, h1Away, scoreHome, scoreAway,
          isH2, minute,
          hc.line, hc.homeOdds, hc.awayOdds,
          ou.line, ou.overOdds, ou.underOdds,
          yellowHome, yellowAway, redHome, redAway,
          cornersHome, cornersAway,
        ]
      )
      count++
    } catch (e) {
      // Non-fatal: skip bad event
    }
  }
  return count
}

// After gs_matches_history is updated, back-fill tt_home/tt_away into odds log rows
// for matches that ended (outcome_filled = false)
async function fillOddsOutcomes() {
  try {
    await pool.query(`
      UPDATE gs_match_odds_log ol
      SET
        tt_home        = mh.tt_home,
        tt_away        = mh.tt_away,
        outcome_filled = TRUE
      FROM gs_matches_history mh
      WHERE ol.outcome_filled = FALSE
        AND ol.home_team = mh.home_team
        AND ol.away_team = mh.away_team
        AND DATE(ol.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh') =
            DATE((mh.match_time / 1000)::BIGINT::TIMESTAMPTZ AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND mh.tt_home IS NOT NULL
    `)
  } catch (e) {
    // Table may not exist yet; silently skip
  }
}

// ── Poll loops ────────────────────────────────────────────────────────────────

async function poll() {
  const date = vnTodayIso()
  const ts   = new Date().toLocaleTimeString('vi-VN')
  console.log(`[${ts}] GS Matches — fetching ${date}`)
  try {
    const raw   = await fetchDay(date)
    const count = await upsertMatches(raw)
    console.log(`[${ts}] GS Matches — upserted ${count} rows`)
    // Back-fill outcomes for odds log after history is fresh
    await fillOddsOutcomes()
  } catch (e) {
    console.error(`[${ts}] GS Matches ERROR:`, e.message)
  }
}

async function pollLive() {
  const ts = new Date().toLocaleTimeString('vi-VN')
  try {
    const events = await fetchLive()
    if (events.length > 0) {
      const count = await logLiveOdds(events)
      if (count > 0) console.log(`[${ts}] GS Odds — logged ${count} live snapshots`)
    }
  } catch (e) {
    console.error(`[${ts}] GS Odds ERROR:`, e.message)
  }
}

console.log('GS Matches Collector started — polling every 2min')
console.log(`DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<hidden>@')}`)
poll()
pollLive()
setInterval(poll,     POLL_MS)
setInterval(pollLive, POLL_MS)
