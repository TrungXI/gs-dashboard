'use strict'
 require('dns').setDefaultResultOrder('ipv4first')
require('net').setDefaultAutoSelectFamily(false)

require('dotenv').config()
const { execSync } = require('child_process')
const fs           = require('fs')
const path         = require('path')

const TG_BOT_TOKEN  = process.env.TG_BOT_TOKEN || '8867426775:AAE1_oibMcHUUHL8VaiJIPPZz4XyTMz5zhw'
const OWNER_CHAT_ID = String(process.env.TG_CHAT_ID || '738682531')
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

async function tgSend(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text }),
  })
}

function updateEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : ''
  if (content.match(new RegExp(`^${key}=.*`, 'm'))) {
    content = content.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}`)
  } else {
    content += `\n${key}=${value}`
  }
  fs.writeFileSync(ENV_PATH, content)
}

async function handleUpdate(update) {
  const msg = update.message
  if (!msg || !msg.text) return

  const chatId = String(msg.chat.id)
  const text   = msg.text.trim()
  const isOwner = chatId === OWNER_CHAT_ID || String(msg.from?.id) === OWNER_CHAT_ID

  // /chatid — bất kỳ ai, bất kỳ chat nào
  if (text === '/chatid' || text.startsWith('/chatid@')) {
    await tgSend(chatId, `Chat ID: \`${chatId}\`\nType: ${msg.chat.type}\nTitle: ${msg.chat.title || msg.chat.first_name || ''}`)
    return
  }

  // Các lệnh còn lại chỉ owner
  if (!isOwner) return

  // /settoken 69-abc...
  const tokenMatch = text.match(/^\/settoken\s+(69-[a-f0-9]+)$/i)
  if (tokenMatch) {
    const newToken = tokenMatch[1]
    try {
      updateEnvKey('GS_TOKEN', newToken)
      execSync(`GS_TOKEN=${newToken} pm2 restart gs-collector gs-matches-collector --update-env`, { stdio: 'pipe' })
      await tgSend(chatId, `✅ Token đã update!\n${newToken}\n\nCollector đã restart.`)
      console.log(`[BOT] Token updated to ${newToken}`)
    } catch (e) {
      await tgSend(chatId, `❌ Lỗi khi update token: ${e.message}`)
    }
    return
  }

  // /setchat <chat_id> — set group nhận HT notification
  const chatMatch = text.match(/^\/setchat\s+(-?\d+)$/)
  if (chatMatch) {
    const newChatId = chatMatch[1]
    try {
      updateEnvKey('TELEGRAM_NOTIFY_CHAT', newChatId)
      execSync('pm2 restart gs-capture --update-env', { stdio: 'pipe' })
      await tgSend(chatId, `✅ Group chat đã set: ${newChatId}\ngs-capture đã restart — HT notification sẽ gửi vào group đó.`)
      console.log(`[BOT] Notify chat set to ${newChatId}`)
    } catch (e) {
      await tgSend(chatId, `❌ Lỗi: ${e.message}`)
    }
    return
  }

  if (text.startsWith('/settoken')) {
    await tgSend(chatId, '❌ Format sai. Dùng:\n/settoken 69-<token>')
  }
  if (text.startsWith('/setchat')) {
    await tgSend(chatId, '❌ Format sai. Dùng:\n/setchat <chat_id>\nVí dụ: /setchat -1001234567890')
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

console.log('GS Bot started')
tgSend(OWNER_CHAT_ID, "🤖 GS Bot online! /settoken /setchat /chatid")
setInterval(poll, POLL_MS)
poll()
