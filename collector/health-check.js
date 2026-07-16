'use strict'
 require('dns').setDefaultResultOrder('ipv4first')
require('net').setDefaultAutoSelectFamily(false)
require('dotenv').config({ path: '/opt/gs-collector/.env' })
const fs = require('fs')
const { execSync } = require('child_process')

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw'
const TG_CHAT  = process.env.TELEGRAM_NOTIFY_CHAT || '-5204950200'
const STATE    = '/opt/gs-collector/.health-state.json'

// ── Ngưỡng ──
const RAM_MIN_MB   = 80     // available RAM tối thiểu
const SWAP_MAX_PCT = 80     // swap dùng tối đa %
const LOAD_MAX     = 3.0    // load 1-min (1 core)
const DISK_MAX_PCT = 88     // disk dùng tối đa %

function meminfo() {
  const m = {}
  for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
    const [k, v] = line.split(':')
    if (v) m[k.trim()] = parseInt(v.trim())  // kB
  }
  return m
}

function checkAll() {
  const problems = []
  const m = meminfo()

  const availMB = Math.round((m.MemAvailable || 0) / 1024)
  if (availMB < RAM_MIN_MB) problems.push(`🔴 RAM available thấp: ${availMB}MB (< ${RAM_MIN_MB}MB)`)

  const swapUsedPct = m.SwapTotal ? Math.round((m.SwapTotal - m.SwapFree) / m.SwapTotal * 100) : 0
  if (swapUsedPct > SWAP_MAX_PCT) problems.push(`🔴 Swap dùng ${swapUsedPct}% (> ${SWAP_MAX_PCT}%)`)

  const load1 = parseFloat(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0])
  if (load1 > LOAD_MAX) problems.push(`🟠 CPU load cao: ${load1} (> ${LOAD_MAX})`)

  try {
    const dfLine = execSync("df / | tail -1", { encoding: 'utf8' }).trim().split(/\s+/)
    const diskPct = parseInt(dfLine[4])
    if (diskPct > DISK_MAX_PCT) problems.push(`🔴 Disk đầy: ${diskPct}% (> ${DISK_MAX_PCT}%)`)
  } catch {}

  try {
    const apps = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }))
    for (const a of apps) {
      if (a.pm2_env.status !== 'online') {
        problems.push(`🔴 App "${a.name}" ${a.pm2_env.status.toUpperCase()}`)
      }
    }
  } catch (e) {
    problems.push(`🔴 Không đọc được PM2: ${e.message}`)
  }

  return problems
}

async function tg(text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  }).catch(() => {})
}

async function main() {
  const problems = checkAll()
  let prev = { bad: false }
  try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch {}

  const nowBad = problems.length > 0

  if (nowBad) {
    // Chỉ bắn khi mới chuyển sang bad, hoặc danh sách vấn đề đổi
    const sig = problems.join('|')
    if (!prev.bad || prev.sig !== sig) {
      await tg(`⚠️ <b>CẢNH BÁO HỆ THỐNG GS</b>\n\n${problems.join('\n')}\n\n<i>VPS 103.82.23.48</i>`)
    }
    fs.writeFileSync(STATE, JSON.stringify({ bad: true, sig }))
  } else {
    if (prev.bad) {
      await tg(`✅ <b>Hệ thống GS đã phục hồi</b>\nMọi chỉ số về mức bình thường.`)
    }
    fs.writeFileSync(STATE, JSON.stringify({ bad: false }))
  }
}

main()
