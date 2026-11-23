// Google Workspace adapter (Gmail + Calendar REST). Activated when the user has
// linked an account through /auth/google on a normal browser (Google sign-in
// does not work inside the Even App WebView). The refresh token is stored
// locally in .data/ (git-ignored) and never sent to the glasses.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Email, Meeting, Person, SendRequest, Workspace } from '../src/core/types.ts'

const TOKEN_FILE = '.data/google-token.json'
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid', 'email', 'profile',
]

const env = () => ({
  id: process.env.GOOGLE_CLIENT_ID ?? '',
  secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  redirect: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8787/auth/google/callback',
})

export function googleConfigured(): boolean {
  return Boolean(env().id && env().secret)
}
export function googleLinked(): boolean {
  return googleConfigured() && (existsSync(TOKEN_FILE) || Boolean(process.env.GOOGLE_REFRESH_TOKEN))
}

export function authUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: env().id, redirect_uri: env().redirect, response_type: 'code', access_type: 'offline',
    prompt: 'consent', scope: SCOPES.join(' '), state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

export async function exchangeCode(code: string): Promise<void> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env().id, client_secret: env().secret, redirect_uri: env().redirect, grant_type: 'authorization_code' }),
  })
  if (!r.ok) throw new Error(`token exchange HTTP ${r.status}`)
  const j = (await r.json()) as { refresh_token?: string }
  if (!j.refresh_token) throw new Error('no refresh_token returned')
  mkdirSync('.data', { recursive: true })
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: j.refresh_token }), { mode: 0o600 })
}

let cached: { token: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token
  const refresh = process.env.GOOGLE_REFRESH_TOKEN ?? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).refresh_token
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: env().id, client_secret: env().secret, grant_type: 'refresh_token' }),
  })
  if (!r.ok) throw new Error(`token refresh HTTP ${r.status}`)
  const j = (await r.json()) as { access_token: string; expires_in: number }
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }
  return cached.token
}

async function g<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${await accessToken()}` } })
  if (!r.ok) throw new Error(`${new URL(url).pathname} HTTP ${r.status}`)
  return (await r.json()) as T
}

export function parsePerson(raw: string): Person {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/)
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim().toLowerCase() }
  return { name: raw.trim(), email: raw.trim().toLowerCase() }
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function listEmails(query: string, max: number): Promise<Email[]> {
  const list = await g<{ messages?: { id: string }[] }>(`${GMAIL}/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`)
  const out: Email[] = []
  for (const { id } of list.messages ?? []) {
    const m = await g<any>(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`)
    const h = (n: string) => m.payload?.headers?.find((x: any) => x.name.toLowerCase() === n.toLowerCase())?.value ?? ''
    out.push({
      id: m.id, threadId: m.threadId, from: parsePerson(h('From')), subject: h('Subject') || '(no subject)',
      snippet: (m.snippet ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      receivedAt: new Date(Number(m.internalDate)).toISOString(), labels: m.labelIds ?? [], messageIdHeader: h('Message-ID') || undefined,
    })
  }
  return out
}

export async function loadGoogleWorkspace(now = new Date()): Promise<Workspace> {
  const me = await g<{ emailAddress: string }>(`${GMAIL}/profile`)
  const emails = await listEmails('in:inbox newer_than:3d -category:promotions', 12)
  const cal = await g<any>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
    timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 12 * 3600_000).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '5',
  })}`)
  const meetings: Meeting[] = []
  for (const ev of cal.items ?? []) {
    if (!ev.start?.dateTime) continue // skip all-day events
    const attendees: Person[] = (ev.attendees ?? [])
      .filter((a: any) => !a.self && !a.resource)
      .map((a: any) => ({ name: a.displayName ?? a.email, email: String(a.email).toLowerCase() }))
    const related = emails.filter(e => attendees.some(a => a.email === e.from.email))
    meetings.push({
      id: ev.id, title: ev.summary ?? '(untitled)', start: ev.start.dateTime, end: ev.end?.dateTime ?? ev.start.dateTime,
      location: ev.hangoutLink ? 'Google Meet' : ev.location, attendees,
      context: related.slice(0, 3).map(e => `${e.from.name.split(' ')[0]}: ${e.subject}`),
      todos: [], relatedThreadId: related[0]?.threadId,
    })
  }
  return { source: 'google', user: { name: me.emailAddress.split('@')[0], email: me.emailAddress }, meetings, emails, vips: (process.env.GLANCE_VIPS ?? '').toLowerCase().split(',').filter(Boolean) }
}

export function buildRaw(req: SendRequest, from: string): string {
  const subject = /^re:/i.test(req.subject) ? req.subject : `Re: ${req.subject}`
  const lines = [
    `From: ${from}`, `To: ${req.to.name} <${req.to.email}>`, `Subject: ${subject}`,
    ...(req.inReplyTo ? [`In-Reply-To: ${req.inReplyTo}`, `References: ${req.inReplyTo}`] : []),
    'Content-Type: text/plain; charset="UTF-8"', '', req.body,
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

export async function sendGmail(req: SendRequest): Promise<string> {
  const me = await g<{ emailAddress: string }>(`${GMAIL}/profile`)
  const r = await g<{ id: string }>(`${GMAIL}/messages/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw: buildRaw(req, me.emailAddress), ...(req.threadId ? { threadId: req.threadId } : {}) }),
  })
  return r.id
}
