'use strict'

require('dotenv').config()
const { Pool } = require('pg')

const GS_TOKEN = process.env.GS_TOKEN || '69-4da0041e12f5643e1537a1495bb1db3d'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

function renameTeam(name) {
  return String(name).replace(/ \(V\)$/, ' (20p)').replace(/ \(S\)$/, ' (16p)')
}

function getDates(from, to) {
  const dates = []
  const cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    const yyyy = cur.getUTCFullYear()
    const mm   = String(cur.getUTCMonth() + 1).padStart(2, '0')
    const dd   = String(cur.getUTCDate()).padStart(2, '0')
    dates.push(`${yyyy}-${mm}-${dd}`)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
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
    const res  = await fetch(url, { headers })
    const text = await res.text()
    if (!text || text.trim() === '' || text.trim() === '""') break
    let d = JSON.parse(text)
    if (typeof d === 'string') {
      if (!d.trim()) break
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

async function main() {
  const dates = getDates('2026-06-21', '2026-07-13')
  console.log(`Backfill ${dates.length} ngày: ${dates[0]} → ${dates[dates.length - 1]}`)
  let total = 0
  for (const date of dates) {
    try {
      const raw = await fetchDay(date)
      const n   = await upsertMatches(raw)
      total += n
      console.log(`  ${date}: ${n} rows`)
    } catch (e) {
      console.error(`  ${date}: ERROR - ${e.message}`)
    }
  }
  console.log(`\nDone! Tổng: ${total} rows`)
  await pool.end()
}

main()
