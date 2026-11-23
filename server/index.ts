// Glance Brief backend: keeps API keys server-side, proxies Gmail/Calendar,
// LLM drafting and speech-to-text, and enforces the confirm-before-send rule.
// Zero runtime dependencies: Node >= 22.18 runs this TypeScript directly.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { demoWorkspace } from '../src/core/demoData.ts'
import type { DraftRequest, SendRequest } from '../src/core/types.ts'
import { authUrl, exchangeCode, googleConfigured, googleLinked, loadGoogleWorkspace, sendGmail } from './google.ts'
import { draft, provider } from './llm.ts'
import { loadTelegram, sendTelegram, telegramEnabled } from './telegram.ts'
import { transcribe } from './stt.ts'

const PORT = Number(process.env.PORT ?? 8787)
const DEMO_SENT: { at: string; to: string; subject: string; body: string }[] = []
const oauthStates = new Set<string>()

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = 2_000_000): Promise<Buffer> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) {
    n += (c as Buffer).length
    if (n > limit) throw new Error('body too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
function serveStatic(res: ServerResponse, path: string): boolean {
  const file = normalize(join('dist', path === '/' ? 'index.html' : path))
  if (!file.startsWith('dist') || !existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
  return true
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {})
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, llm: provider()?.name ?? 'template', google: googleLinked() ? 'linked' : googleConfigured() ? 'not-linked' : 'off', telegram: telegramEnabled(), stt: Boolean(process.env.MINIMAX_API_KEY) })
    }
    if (url.pathname === '/api/workspace') {
      const live = process.env.GLANCE_DEMO !== '1'
      const ws = live && googleLinked() ? await loadGoogleWorkspace() : demoWorkspace()
      if (live && telegramEnabled()) {
        const tg = await loadTelegram().catch(e => { console.warn('[server] telegram', String(e)); return [] })
        ws.emails = [...ws.emails.filter(e => e.channel !== 'telegram'), ...tg]
        if (ws.source === 'demo') ws.source = 'mixed'
      }
      return json(res, 200, ws)
    }
    if (url.pathname === '/api/draft' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8')) as DraftRequest
      return json(res, 200, await draft(body))
    }
    if (url.pathname === '/api/stt' && req.method === 'POST') {
      const pcm = await readBody(req, 1_100_000) // ≈34 s of 16 kHz s16le
      const text = await transcribe(new Uint8Array(pcm))
      console.log(`[server] STT ${pcm.length} bytes → ${text ? `"${text}"` : '(no speech)'}`)
      if (process.env.GLANCE_DEBUG_AUDIO === '1') writeFileSync('.data/last-stt.pcm', pcm)
      return json(res, 200, { text })
    }
    if (url.pathname === '/api/send' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8')) as SendRequest
      if (body.confirmed !== true) return json(res, 400, { ok: false, mode: 'demo', error: 'explicit confirmation required' })
      if (!body.body?.trim() || !body.to?.email) return json(res, 400, { ok: false, mode: 'demo', error: 'empty reply' })
      const live = process.env.GLANCE_DEMO !== '1'
      // Demo items carry chatId 0 and never reach the real Bot API.
      if (body.channel === 'telegram' && live && telegramEnabled() && body.chatId) {
        return json(res, 200, { ok: true, mode: 'telegram', id: await sendTelegram(body) })
      }
      if (body.channel !== 'telegram' && live && googleLinked()) return json(res, 200, { ok: true, mode: 'gmail', id: await sendGmail(body) })
      DEMO_SENT.push({ at: new Date().toISOString(), to: body.to.email, subject: body.subject, body: body.body })
      console.log(`[server] DEMO send (not delivered) to=${body.to.email} subject="${body.subject}"`)
      return json(res, 200, { ok: true, mode: 'demo', id: `demo-${DEMO_SENT.length}` })
    }
    if (url.pathname === '/api/demo-outbox') return json(res, 200, DEMO_SENT)
    if (url.pathname === '/auth/google') {
      if (!googleConfigured()) return json(res, 400, { error: 'set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first' })
      const state = randomUUID(); oauthStates.add(state)
      res.writeHead(302, { location: authUrl(state) }); return res.end()
    }
    if (url.pathname === '/auth/google/callback') {
      const state = url.searchParams.get('state') ?? ''
      if (!oauthStates.delete(state)) return json(res, 400, { error: 'bad state' })
      await exchangeCode(url.searchParams.get('code') ?? '')
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<p>Google account linked. You can close this tab and open Glance Brief on your G2.</p>')
    }
    if (req.method === 'GET' && serveStatic(res, url.pathname)) return
    json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error('[server] error', url.pathname, String(e))
    json(res, 500, { ok: false, error: String(e) })
  }
})

if (process.argv[1]?.endsWith('index.ts')) {
  server.listen(PORT, () => console.log(`[server] Glance Brief backend on http://localhost:${PORT} · llm=${provider()?.name ?? 'template'} · google=${googleLinked() ? 'linked' : 'demo'}`))
}
