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

    // Resolve team IDs — upsert so new teams are auto-registered
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

// ── Live odds logger ──────────────────────────────────────────────────────────

const GS_LEAGUE_IDS = new Set([2140, 2125])
const MATCH_TYPE_MAP = { 2140: '16p', 2125: '20p' }

function parseAsianOdds(market7, key) {
  if (!market7 || !market7[key]) return { line: null, homeOdds: null, awayOdds: null }
  const entries = Array.isArray(market7[key]) ? market7[key].map(String) : [String(market7[key])]
  const e = entries[0] || ''
  let line = null, homeOdds = null, awayOdds = null
  for (const token of e.trim().split(/\s+/)) {
    if (token.includes('*')) {
      const [val, sel] = token.split('*')
      const side = sel?.slice(-1)
      if (side === 'h' && homeOdds == null) homeOdds = val
      else if (side === 'a' && awayOdds == null) awayOdds = val
    } else if (line == null && /^-?[\d.]+([-][\d.]+)?$/.test(token)) {
      line = token
    }
  }
  return {
    line:     line != null ? parseFloat(line) : null,
    homeOdds: homeOdds != null ? parseFloat(homeOdds) : null,
    awayOdds: awayOdds != null ? parseFloat(awayOdds) : null,
  }
}

async function fetchLive() {
  const headers = { token: GS_TOKEN, accept: 'application/json', lng: 'en' }
  const res = await fetch('https://be.sb21.net/api/v2/getEvent?sportType=3_1&timezoneOffset=-420', { headers })
  const json = await res.json()

  const events = []
  if (json && typeof json === 'object' && !Array.isArray(json) && json.data) {
    for (const [key, list] of Object.entries(json.data)) {
      const lid = Number(key)
      if (!GS_LEAGUE_IDS.has(lid)) continue
      for (const ev of (list ?? [])) events.push({ lid, ev })
    }
  } else {
    const liveSection = Array.isArray(json[0]) ? json[0] : []
    for (const league of liveSection) {
      const lid = league['0']
      if (!GS_LEAGUE_IDS.has(lid)) continue
      for (const ev of (league['2'] ?? [])) events.push({ lid, ev })
    }
  }
  return events
}

async function logLiveOdds(events) {
  let count = 0
  for (const { lid, ev } of events) {
    try {
      const eventId   = ev['8'] || null
      const homeTeam  = renameTeam(ev['2'] || '')
      const awayTeam  = renameTeam(ev['3'] || '')
      const matchType = MATCH_TYPE_MAP[lid] ?? '16p'
      if (!homeTeam || !awayTeam) continue

      // Resolve IDs — upsert so new teams are auto-registered
      const [homeTeamId, awayTeamId] = await Promise.all([
        getOrCreateTeamId(homeTeam),
        getOrCreateTeamId(awayTeam),
      ])

      const score       = ev['4'] ?? {}
      const market7     = ev['7'] ?? {}
      const ev6ms       = typeof ev['6'] === 'number' ? ev['6'] : null
      const minute      = ev6ms != null ? Math.ceil(ev6ms / 60000) : 0
      const isH2        = ev['10'] === 8
      const h1Home      = parseInt(score['0'] ?? 0, 10)
      const h1Away      = parseInt(score['1'] ?? 0, 10)
      const redHome     = parseInt(score['2'] ?? 0, 10)
      const redAway     = parseInt(score['3'] ?? 0, 10)
      const cornersHome = parseInt(score['5'] ?? 0, 10)
      const cornersAway = parseInt(score['6'] ?? 0, 10)
      const yellowHome  = parseInt(score['7'] ?? 0, 10)
      const yellowAway  = parseInt(score['8'] ?? 0, 10)
      const hc = parseAsianOdds(market7, '5')
      const ou = parseAsianOdds(market7, '3')

      await pool.query(
        `INSERT INTO gs_match_odds_log
           (event_id, home_team, away_team, match_type,
            home_team_id, away_team_id,
            h1_home, h1_away, score_home, score_away,
            is_h2, minute_elapsed,
            hc_line, hc_home_odds, hc_away_odds,
            ou_line, ou_over_odds, ou_under_odds,
            yellow_home, yellow_away, red_home, red_away,
            corners_home, corners_away)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [
          eventId, homeTeam, awayTeam, matchType,
          homeTeamId, awayTeamId,
          h1Home, h1Away, h1Home, h1Away,
          isH2, minute,
          hc.line, hc.homeOdds, hc.awayOdds,
          ou.line, ou.homeOdds, ou.awayOdds,
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

/** Back-fill outcomes using ID-based join — no string matching */
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
        AND ol.home_team_id IS NOT NULL
        AND ol.home_team_id = mh.home_team_id
        AND ol.away_team_id = mh.away_team_id
        AND DATE(ol.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh') =
            DATE((mh.match_time / 1000)::BIGINT::TIMESTAMPTZ AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND mh.tt_home IS NOT NULL
    `)
  } catch (e) {
    // Silently skip
  }

  try {
    await pool.query(`
      UPDATE gs_matches_history mh
      SET event_id = subq.event_id
      FROM (
        SELECT DISTINCT ON (mol.home_team_id, mol.away_team_id, DATE(mol.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))
          mol.home_team_id, mol.away_team_id,
          DATE(mol.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS match_date,
          mol.event_id
        FROM gs_match_odds_log mol
        WHERE mol.event_id IS NOT NULL
          AND mol.home_team_id IS NOT NULL
        ORDER BY mol.home_team_id, mol.away_team_id,
                 DATE(mol.recorded_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), mol.recorded_at ASC
      ) subq
      WHERE mh.event_id IS NULL
        AND mh.home_team_id = subq.home_team_id
        AND mh.away_team_id = subq.away_team_id
        AND DATE(mh.match_time AT TIME ZONE 'Asia/Ho_Chi_Minh') = subq.match_date
    `)
  } catch (e) {
    // Silently skip
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
