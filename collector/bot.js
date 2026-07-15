'use strict'

require('dotenv').config()
const { execSync } = require('child_process')
const fs           = require('fs')
const path         = require('path')

const TG_BOT_TOKEN  = process.env.TG_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw'
const TG_CHAT_ID    = String(process.env.TG_CHAT_ID || '738682531')
const ENV_PATH      = path.join(__dirname, '.env')
const OFFSET_PATH   = path.join(__dirname, '.tg-offset')
const POLL_MS       = 3000

function loadOffset() {
  try { return parseInt(fs.readFileSync(OFFSET_PATH, 'utf8').trim(), 10) || 0 } catch { return 0 }
}
function saveOffset(val) {
  try { fs.writeFileSync(OFFSET_PATH, String(val)) } catch {}
}

let offset = loadOffset()

async function tgGet(method, params = {}) {
  const qs  = new URLSearchParams(params).toString()
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}?${qs}`)
  return res.json()
}

async function tgSend(text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({ chat_id: TG_CHAT_ID, text }),
  })
}

function updateEnvToken(newToken) {
  let content = ''
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8')
    if (content.match(/^GS_TOKEN=.*/m)) {
      content = content.replace(/^GS_TOKEN=.*/m, `GS_TOKEN=${newToken}`)
    } else {
      content += `\nGS_TOKEN=${newToken}`
    }
  } else {
    content = `GS_TOKEN=${newToken}\n`
  }
  fs.writeFileSync(ENV_PATH, content)
}

async function handleUpdate(update) {
  const msg = update.message
  if (!msg || !msg.text) return

  // Chỉ chấp nhận từ owner
  if (String(msg.chat.id) !== TG_CHAT_ID) return

  const text = msg.text.trim()

  // /settoken 69-abc123...
  const match = text.match(/^\/settoken\s+(69-[a-f0-9]+)$/i)
  if (!match) {
    if (text.startsWith('/settoken')) {
      await tgSend('❌ Format sai. Dùng:\n/settoken 69-<token>')
    }
    return
  }

  const newToken = match[1]
  try {
    updateEnvToken(newToken)
    execSync('pm2 restart gs-collector gs-matches-collector --update-env', { stdio: 'pipe' })
    await tgSend(`✅ Token đã update!\n\`${newToken}\`\n\nCollector đã restart.`)
    console.log(`[BOT] Token updated to ${newToken}`)
  } catch (e) {
    await tgSend(`❌ Lỗi khi update: ${e.message}`)
    console.error('[BOT ERROR]', e.message)
  }
}

async function poll() {
  try {
    const data = await tgGet('getUpdates', { offset, timeout: 20, allowed_updates: 'message' })
    if (!data.ok || !data.result.length) return
    for (const update of data.result) {
      await handleUpdate(update)
      offset = update.update_id + 1
      saveOffset(offset)
    }
  } catch (e) {
    console.error('[POLL ERROR]', e.message)
  }
}

console.log('GS Bot started — waiting for /settoken command')
tgSend('🤖 GS Bot online!\nGửi /settoken 69-<token> để update token mới.')
setInterval(poll, POLL_MS)
poll()
