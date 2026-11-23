// LLM drafting. Provider order: OpenRouter (track-listed) → MiniMax → local template.
// Keys come only from environment variables and never leave the server.
import { templateDraft } from '../src/core/templates.ts'
import type { DraftRequest, DraftResult, DraftVariant } from '../src/core/types.ts'

interface Provider { name: 'openrouter' | 'minimax'; url: string; key: string; model: string }

export function provider(env: Record<string, string | undefined> = process.env): Provider | null {
  const pick = env.LLM_PROVIDER // optional override: "openrouter" | "minimax" | "template"
  if (pick === 'template') return null
  if (env.OPENROUTER_API_KEY && pick !== 'minimax') {
    return { name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini' }
  }
  if (env.MINIMAX_API_KEY) {
    const base = (env.MINIMAX_BASE_URL ?? 'https://api.minimax.cn/v1').replace(/\/$/, '')
    return { name: 'minimax', url: `${base}/text/chatcompletion_v2`, key: env.MINIMAX_API_KEY, model: env.MINIMAX_MODEL ?? 'MiniMax-M3.1-Flash' }
  }
  return null
}

const SYSTEM = `You write email replies that will be read on smart-glasses and confirmed with one tap.
Rules: plain text, no markdown, no subject line, start with "Hi <their first name>,", max 45 words per reply,
never invent facts, prices or dates that are not in the thread or the user's spoken intent.
If the user gave a spoken intent, the main reply must express exactly that intent.
Return ONLY compact JSON: {"reply":"...","short":"...","later":"..."} where
reply = the best full answer, short = a one-line acknowledgement, later = politely defer.
End every reply with a new line containing only the user's first name.`

export function parseVariants(raw: string): DraftVariant[] | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(json)?/g, '').trim()
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const out: DraftVariant[] = []
    for (const [k, label] of [['reply', 'Reply'], ['short', 'Short'], ['later', 'Later']] as const) {
      if (typeof j[k] === 'string' && (j[k] as string).trim()) out.push({ label, body: (j[k] as string).trim() })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

export async function chat(p: Provider, system: string, user: string, maxTokens = 2000): Promise<string> {
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${p.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: p.model, max_tokens: maxTokens, temperature: 0.4, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!r.ok) throw new Error(`${p.name} HTTP ${r.status}`)
  const j = (await r.json()) as any
  if (j.base_resp && j.base_resp.status_code !== 0) throw new Error(`${p.name} error ${j.base_resp.status_code}`)
  return String(j.choices?.[0]?.message?.content ?? '')
}

export async function draft(req: DraftRequest, env: Record<string, string | undefined> = process.env): Promise<DraftResult> {
  const p = provider(env)
  if (!p) return templateDraft(req)
  const user = [
    `User (sender of the reply): ${req.userName}`,
    `Replying to: ${req.to.name} <${req.to.email}>`,
    `Subject: ${req.subject}`,
    `Their message: ${req.threadSnippet}`,
    req.channel === 'telegram' ? 'Channel: Telegram group chat. Override the format rules: no greeting, no sign-off, casual, max 25 words per reply.' : 'Channel: email.',
    req.intent ? `User's spoken intent: "${req.intent}"` : 'No spoken intent: propose the most helpful sensible reply.',
  ].join('\n')
  try {
    const raw = await chat(p, SYSTEM, user)
    const variants = parseVariants(raw)
    if (!variants) throw new Error(`unparseable LLM output (${raw.length} chars)`)
    return { engine: p.name, variants }
  } catch (e) {
    console.warn('[server] LLM draft failed, template used:', String(e))
    return templateDraft(req)
  }
}
