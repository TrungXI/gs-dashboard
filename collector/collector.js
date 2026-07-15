'use strict'

require('dotenv').config()

const { Pool } = require('pg')
const GS_TOKEN      = process.env.GS_TOKEN || '69-aa116c3c7df75dbf33f2931adf208164'
const POLL_MS       = 2000

const TG_BOT_TOKEN  = process.env.TG_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw'
const TG_CHAT_ID    = process.env.TG_CHAT_ID   || '738682531'
let tokenExpired = false  // true khi đang trong trạng thái hết hạn

async function tgSend(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    })
    console.log('[TG]', msg)
  } catch (e) {
    console.error('[TG ERROR]', e.message)
  }
}

const GS_LEAGUE_IDS = new Set([2140, 2125])
const MATCH_TYPE    = { 2140: '16p', 2125: '20p' }

const VN_TO_EN = {
  'Nhật Bản': 'Japan', 'Hàn Quốc': 'Korea Republic', 'Trung Quốc': 'China',
  'Thái Lan': 'Thailand', 'Việt Nam': 'Vietnam', 'Ả Rập Xê Út': 'Saudi Arabia',
  'Ả Rập Saudi': 'Saudi Arabia', 'Úc': 'Australia', 'Ấn Độ': 'India',
  'Campuchia': 'Cambodia', 'Lào': 'Laos', 'Nga': 'Russia', 'Đức': 'Germany',
  'Pháp': 'France', 'Tây Ban Nha': 'Spain', 'Bồ Đào Nha': 'Portugal',
  'Hà Lan': 'Netherlands', 'Bỉ': 'Belgium', 'Thụy Sĩ': 'Switzerland(CHE)',
  'Thụy Điển': 'Sweden', 'Na Uy': 'Norway', 'Áo': 'Austria', 'Ý': 'Italy',
  'Anh': 'England', 'Maroc': 'Morocco', 'Mỹ': 'USA',
  'Viet Nam': 'Vietnam', 'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic', 'DPR Korea': 'North Korea',
  'Korea DPR': 'North Korea',
}

function normalizeTeam(name) {
  const m = name.trim().match(/^(.+?)(\s+\([VS]\))?$/)
  if (!m) return name.trim()
  const base = m[1].trim()
  const suffix = m[2]?.trim() ? ` ${m[2].trim()}` : ''
  return ((VN_TO_EN[base] ?? base) + suffix).trim()
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

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

const prevState = new Map()

// ─── Parsing ──────────────────────────────────────────────────────────────────

function decToMalay(dec) {
  if (dec >= 2.0) return `+${(dec - 1).toFixed(2)}`
  return (-(1 / (dec - 1))).toFixed(2)
}

function parse1x2(market7) {
  const empty = { home: null, away: null, draw: null }
  if (!market7 || typeof market7 !== 'object') return empty
  const m = market7['1']
  if (m == null) return empty
  const entries = Array.isArray(m) ? m.map(String) : String(m).split(/\s+/)
  const out = { ...empty }
  for (const raw of entries) {
    for (const token of raw.trim().split(/\s+/)) {
      const [oddsStr, sel] = token.split('*')
      if (!oddsStr || !sel) continue
      const dec = Number(oddsStr)
      if (!Number.isFinite(dec)) continue
      const side = sel.slice(-1)
      if (side === 'h' && out.home == null) out.home = dec
      else if (side === 'a' && out.away == null) out.away = dec
      else if (side === 'd' && out.draw == null) out.draw = dec
    }
  }
  return out
}

function parseAsianEntry(raw) {
  const tokens = raw.trim().split(/\s+/)
  let line = null, h = null, a = null, indicator = null
  const suspended = tokens[tokens.length - 1] === '1'
  for (const token of tokens) {
    if (token.includes('*')) {
      const si  = token.indexOf('*')
      const val = token.slice(0, si)
      const sel = token.slice(si + 1)
      const side = sel.slice(-1)
      if (side === 'h' && h == null) h = val
      else if (side === 'a' && a == null) a = val
    } else if (token === 'h' || token === 'a') {
      if (indicator == null) indicator = token
    } else if (line == null && /^-?[\d.]+([-][\d.]+)?$/.test(token)) {
      line = token
    }
  }
  return { line, h, a, suspended, indicator }
}

function parseAsianMarket(market7, key) {
  if (!market7 || typeof market7 !== 'object') return []
  const raw = market7[key]
  if (raw == null) return []
  const entries = Array.isArray(raw) ? raw.map(String) : [String(raw)]
  return entries.slice(0, 2).map(e => {
    const { line, h, a, suspended, indicator } = parseAsianEntry(e)
    const homeGives = indicator != null ? indicator === 'h' : (line == null || parseFloat(line) >= 0)
    return { line, home: h, away: a, suspended, homeGives }
  })
}

function buildMatch(leagueId, leagueName, ev) {
  const score   = ev['4'] ?? {}
  const market7 = ev['7']
  const hcRaw   = parseAsianMarket(market7, '5')
  const ouRaw   = parseAsianMarket(market7, '3')
  const hcH1Raw = parseAsianMarket(market7, '6')
  const ouH1Raw = parseAsianMarket(market7, '4')
  const ev6ms   = typeof ev['6'] === 'number' ? ev['6'] : null
  const odds    = parse1x2(market7)
  const suspended = hcRaw.length > 0 ? hcRaw[0].suspended : false

  return {
    leagueId,
    leagueName,
    matchType:     MATCH_TYPE[leagueId] ?? '16p',
    eventId:       ev['8'],
    homeTeam:      normalizeTeam(ev['2']),
    awayTeam:      normalizeTeam(ev['3']),
    h1Home:        score['0'] ?? 0,
    h1Away:        score['1'] ?? 0,
    minuteElapsed: ev6ms !== null ? Math.ceil(ev6ms / 60000) : null,
    period:        typeof ev['10'] === 'number' ? ev['10'] : 0,
    isH2:          ev['10'] === 8,
    isLive:        ev['1'] === true,
    suspended,
    bettingOpen:   ev['11'] !== true,
    oddsHome:      odds.home,
    oddsAway:      odds.away,
    oddsDraw:      odds.draw,
    malayHome:     odds.home != null ? decToMalay(odds.home) : null,
    malayAway:     odds.away != null ? decToMalay(odds.away) : null,
    malayDraw:     odds.draw != null ? decToMalay(odds.draw) : null,
    yellowHome:    score['7'] ?? 0,
    yellowAway:    score['8'] ?? 0,
    redHome:       score['2'] ?? 0,
    redAway:       score['3'] ?? 0,
    cornersHome:   score['5'] ?? 0,
    cornersAway:   score['6'] ?? 0,
    hcLines:   hcRaw.map(({ line, home, away, homeGives }) => ({ line, home, away, homeGives })),
    hcH1Lines: hcH1Raw.map(({ line, home, away, homeGives }) => ({ line, home, away, homeGives })),
    ouLines:   ouRaw.map(r => ({ line: r.line, over: r.home, under: r.away })),
    ouH1Lines: ouH1Raw.map(r => ({ line: r.line, over: r.home, under: r.away })),
  }
}

async function fetchMatches() {
  const res = await fetch(
    'https://be.sb21.net/api/v2/getEvent?sportType=3_1&timezoneOffset=-420',
    { headers: { token: GS_TOKEN, accept: 'application/json', lng: 'vi' } }
  )
  if (res.status === 401 || res.status === 403) {
    if (!tokenExpired) {
      tokenExpired = true
      await tgSend(`⚠️ GS Token hết hạn!\nHTTP ${res.status} từ API\nCần update token mới tại m.zenandfe.com`)
    }
    throw new Error(`GS API ${res.status} — token expired`)
  }
  if (!res.ok) throw new Error(`GS API ${res.status}`)
  const json = await res.json()
  const matches = []

  if (json && typeof json === 'object' && !Array.isArray(json) && json.data) {
    for (const [key, list] of Object.entries(json.data)) {
      const lid = Number(key)
      if (!GS_LEAGUE_IDS.has(lid)) continue
      for (const ev of (list ?? [])) {
        matches.push(buildMatch(lid, ev['1'] ?? MATCH_TYPE[lid] ?? key, ev))
      }
    }
  } else {
    const liveSection = Array.isArray(json[0]) ? json[0] : []
    for (const league of liveSection) {
      const lid = league['0']
      if (!GS_LEAGUE_IDS.has(lid)) continue
      for (const ev of (league['2'] ?? [])) {
        matches.push(buildMatch(lid, league['1'], ev))
      }
    }
  }
  return matches
}

// ─── Change detection ─────────────────────────────────────────────────────────

function oddsKey(match) {
  return JSON.stringify({
    score:  `${match.h1Home}-${match.h1Away}`,
    period: match.period,
    hc:     match.hcLines.map(l => `${l.line}:${l.home}:${l.away}`).join('|'),
    ou:     match.ouLines.map(l => `${l.line}:${l.over}:${l.under}`).join('|'),
    hcH1:   match.hcH1Lines.map(l => `${l.line}:${l.home}:${l.away}`).join('|'),
    ouH1:   match.ouH1Lines.map(l => `${l.line}:${l.over}:${l.under}`).join('|'),
  })
}

function detectSnapshotType(match, key) {
  const prev = prevState.get(match.eventId)
  if (!prev) return 'first_seen'

  const prevData = JSON.parse(prev)
  const [prevHome, prevAway] = prevData.score.split('-').map(Number)

  if (match.h1Home > prevHome || match.h1Away > prevAway) {
    return match.period === 8 ? 'goal_h2' : 'goal_h1'
  }
  if (prevData.period !== match.period) {
    console.log(`[PERIOD] ${match.homeTeam} vs ${match.awayTeam} | ${prevData.period} → ${match.period}`)
    if (match.period === 2) return 'kickoff_h1'
    if (match.period === 8) return 'kickoff_h2'
    // prevPeriod=2, newPeriod not 2 and not 8 → HT bắt đầu
    if (prevData.period === 2) {
      triggerHtCapture(match)
    }
  }
  return null
}

// ─── DB write ─────────────────────────────────────────────────────────────────

async function logSnapshot(match, snapshotType) {
  const [homeTeamId, awayTeamId] = await Promise.all([
    getOrCreateTeamId(match.homeTeam),
    getOrCreateTeamId(match.awayTeam),
  ])

  const values = [
    match.eventId,
    match.matchType,
    match.homeTeam,
    match.awayTeam,
    new Date().toISOString().split('T')[0],
    snapshotType,
    match.period,
    match.minuteElapsed,
    match.isH2,
    match.h1Home,
    match.h1Away,
    match.suspended,
    match.bettingOpen,
    match.oddsHome,
    match.oddsAway,
    match.oddsDraw,
    match.malayHome,
    match.malayAway,
    match.malayDraw,
    match.hcLines[0]?.line      ?? null,
    match.hcLines[0]?.home      ?? null,
    match.hcLines[0]?.away      ?? null,
    match.hcLines[0]?.homeGives ?? null,
    match.hcH1Lines[0]?.line      ?? null,
    match.hcH1Lines[0]?.home      ?? null,
    match.hcH1Lines[0]?.away      ?? null,
    match.hcH1Lines[0]?.homeGives ?? null,
    match.ouLines[0]?.line   ?? null,
    match.ouLines[0]?.over   ?? null,
    match.ouLines[0]?.under  ?? null,
    match.ouH1Lines[0]?.line  ?? null,
    match.ouH1Lines[0]?.over  ?? null,
    match.ouH1Lines[0]?.under ?? null,
    match.yellowHome,
    match.yellowAway,
    match.redHome,
    match.redAway,
    match.cornersHome,
    match.cornersAway,
    homeTeamId,
    awayTeamId,
  ]

  await pool.query(
    `INSERT INTO match_odds_log (
      event_id, match_type, home_team, away_team, match_date,
      snapshot_type, period, minute, is_h2,
      score_home, score_away, suspended, betting_open,
      odds_home, odds_away, odds_draw,
      malay_home, malay_away, malay_draw,
      hc_line, hc_home_odds, hc_away_odds, hc_home_gives,
      hc_h1_line, hc_h1_home_odds, hc_h1_away_odds, hc_h1_home_gives,
      ou_line, ou_over, ou_under,
      ou_h1_line, ou_h1_over, ou_h1_under,
      yellow_home, yellow_away, red_home, red_away,
      corners_home, corners_away,
      home_team_id, away_team_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
      $31,$32,$33,$34,$35,$36,$37,$38,$39,
      $40,$41
    )`,
    values
  )

  const ts = new Date().toLocaleTimeString('vi-VN')
  console.log(
    `[${ts}] ${snapshotType.padEnd(12)} | ${match.homeTeam} vs ${match.awayTeam}` +
    ` | ${match.h1Home}-${match.h1Away}` +
    ` | HC:${match.hcLines[0]?.line ?? '-'} OU:${match.ouLines[0]?.line ?? '-'}`
  )
}

// ─── HT Screenshot trigger ───────────────────────────────────────────────────

const VERCEL_URL    = process.env.VERCEL_URL || 'https://gs-dashboard-two.vercel.app'
const htTriggered   = new Set() // tránh trigger 2 lần cùng 1 trận

function triggerHtCapture(match) {
  if (!match.eventId || htTriggered.has(match.eventId)) return
  htTriggered.add(match.eventId)

  const ts = new Date().toLocaleTimeString('vi-VN')
  console.log(`[HT] ${match.homeTeam} vs ${match.awayTeam} — chụp ảnh sau 5s`)

  // Delay 5s trước khi bắt đầu chụp (Vercel sẽ loop 20 frames × 2s = 40s)
  setTimeout(async () => {
    try {
      const res = await fetch(`${VERCEL_URL}/api/ht-capture`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          eventId:  match.eventId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          h1Home:   match.h1Home,
          h1Away:   match.h1Away,
          token:    GS_TOKEN,
        }),
      })
      const data = await res.json()
      console.log(`[HT] capture done — eventId=${match.eventId} frames=${data.frames ?? '?'} ok=${data.ok}`)
    } catch (e) {
      console.error(`[HT] capture error — ${e.message}`)
    }
  }, 5000)
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const matches = await fetchMatches()

    // Token hoạt động lại → reset flag, bắn 1 noti phục hồi
    if (tokenExpired) {
      tokenExpired = false
      await tgSend('✅ GS Token đã hoạt động trở lại!')
    }

    for (const match of matches) {
      if (!match.isLive) continue

      const key = oddsKey(match)
      const snapshotType = detectSnapshotType(match, key)
      if (snapshotType) {
        await logSnapshot(match, snapshotType)
      }
      prevState.set(match.eventId, key)
    }

    const active = new Set(matches.map(m => m.eventId))
    for (const id of prevState.keys()) {
      if (!active.has(id)) prevState.delete(id)
    }
  } catch (e) {
    console.error('[POLL ERROR]', e.message)
  }
}

console.log('GS Collector started — polling every 2s')
console.log(`DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://<hidden>@')}`)
poll()
setInterval(poll, POLL_MS)
