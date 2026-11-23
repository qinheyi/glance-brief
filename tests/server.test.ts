import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRaw, parsePerson } from '../server/google.ts'
import { parseVariants, provider } from '../server/llm.ts'
import { pcmToWav } from '../server/stt.ts'
import { templateDraft } from '../src/core/templates.ts'

test('parseVariants handles fenced JSON and think tags', () => {
  const v = parseVariants('<think>hmm</think>```json\n{"reply":"Hi Maya, yes.","short":"On it.","later":"Later today."}\n```')
  assert.deepEqual(v?.map(x => x.label), ['Reply', 'Short', 'Later'])
  assert.equal(parseVariants('no json here'), null)
})

test('provider selection prefers OpenRouter, then MiniMax, else template', () => {
  assert.equal(provider({ OPENROUTER_API_KEY: 'x', MINIMAX_API_KEY: 'y' })?.name, 'openrouter')
  assert.equal(provider({ MINIMAX_API_KEY: 'y' })?.name, 'minimax')
  assert.equal(provider({ OPENROUTER_API_KEY: 'x', MINIMAX_API_KEY: 'y', LLM_PROVIDER: 'minimax' })?.name, 'minimax')
  assert.equal(provider({ MINIMAX_API_KEY: 'y', LLM_PROVIDER: 'template' }), null)
  assert.equal(provider({}), null)
})

test('template drafts honour the spoken intent', () => {
  const r = templateDraft({ to: { name: 'Maya Chen', email: 'm@x' }, subject: 's', threadSnippet: '', intent: 'yes, Monday works', userName: 'Qin Heyi' })
  assert.match(r.variants[0].body, /^Hi Maya, yes, Monday works\./)
  assert.equal(r.variants.length, 3)
})

test('pcmToWav writes a valid 16 kHz mono header', () => {
  const w = pcmToWav(new Uint8Array(3200))
  const dv = new DataView(w.buffer)
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF')
  assert.equal(dv.getUint32(24, true), 16000)
  assert.equal(dv.getUint32(40, true), 3200)
})

test('Gmail reply MIME keeps threading headers', () => {
  const raw = Buffer.from(buildRaw({ threadId: 't', to: parsePerson('"Maya Chen" <Maya@x.com>'), subject: 'Go/no-go', body: 'Yes.', inReplyTo: '<abc@x>', confirmed: true }, 'me@x.com'), 'base64url').toString()
  assert.match(raw, /To: Maya Chen <maya@x.com>/)
  assert.match(raw, /Subject: Re: Go\/no-go/)
  assert.match(raw, /In-Reply-To: <abc@x>/)
})

test('Telegram updates become inbox cards, filtered by allowed chats', async () => {
  const { updatesToItems } = await import('../server/telegram.ts')
  const ups = [
    { update_id: 1, message: { message_id: 7, date: 1795430000, text: 'Ship Thursday?', chat: { id: -42, title: 'Acme pilot' }, from: { first_name: 'Leo', last_name: 'Park', username: 'leo' } } },
    { update_id: 2, message: { message_id: 8, date: 1795430001, text: 'spam', chat: { id: 99 }, from: { first_name: 'X' } } },
    { update_id: 3, message: { message_id: 9, date: 1795430002, chat: { id: -42 }, sticker: {} } },
  ]
  const items = updatesToItems(ups, [-42])
  assert.equal(items.length, 1)
  assert.equal(items[0].channel, 'telegram')
  assert.equal(items[0].from.name, 'Leo Park')
  assert.equal(items[0].subject, 'Telegram · Acme pilot')
  assert.equal(items[0].tgMessageId, 7)
})
