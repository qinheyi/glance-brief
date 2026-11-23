// Telegram adapter (Bot API). Messages sent to your bot, or posted in groups the
// bot is a member of, join the same urgency-sorted stack as email; replies go
// back with sendMessage after the user's confirming tap.
// Enabled by TELEGRAM_BOT_TOKEN; optionally restrict to chats in TELEGRAM_CHAT_IDS.
import type { Email, SendRequest } from '../src/core/types.ts'

const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

export function telegramEnabled(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN)
}

export function updatesToItems(updates: any[], allow: number[] = []): Email[] {
  const out: Email[] = []
  for (const u of updates) {
    const m = u.message ?? u.channel_post
    if (!m?.text) continue
    if (allow.length && !allow.includes(m.chat.id)) continue
    const who = m.from ? [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') : m.chat.title ?? 'Telegram'
    out.push({
      id: `tg-${m.chat.id}-${m.message_id}`, threadId: `tg-${m.chat.id}`, channel: 'telegram',
      chatId: m.chat.id, tgMessageId: m.message_id,
      from: { name: who, email: `telegram:${m.from?.username ?? m.chat.id}` },
      subject: `Telegram · ${m.chat.title ?? who}`, snippet: m.text,
      receivedAt: new Date(m.date * 1000).toISOString(), labels: ['INBOX', 'UNREAD'],
    })
  }
  return out
}

export async function loadTelegram(): Promise<Email[]> {
  const r = await fetch(api('getUpdates') + '?allowed_updates=%5B%22message%22,%22channel_post%22%5D&limit=50')
  if (!r.ok) throw new Error(`telegram getUpdates HTTP ${r.status}`)
  const j = (await r.json()) as { result: any[] }
  const allow = (process.env.TELEGRAM_CHAT_IDS ?? '').split(',').map(Number).filter(Boolean)
  // Latest message per chat only: one card per conversation.
  const latest = new Map<string, Email>()
  for (const e of updatesToItems(j.result ?? [], allow)) latest.set(e.threadId, e)
  return [...latest.values()]
}

export async function sendTelegram(req: SendRequest): Promise<string> {
  if (!req.chatId) throw new Error('missing chatId')
  const text = req.body.replace(/^Hi [^,\n]+,\s*/i, '') // chat style: drop the email greeting
  const r = await fetch(api('sendMessage'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: req.chatId, text, ...(req.replyToMessageId ? { reply_parameters: { message_id: req.replyToMessageId } } : {}) }),
  })
  if (!r.ok) throw new Error(`telegram sendMessage HTTP ${r.status}`)
  const j = (await r.json()) as { result: { message_id: number } }
  return String(j.result.message_id)
}
