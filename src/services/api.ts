// Thin client for the Glance Brief backend. Every call degrades gracefully so
// the app still works fully offline (demo data + local templates + demo send).
import { demoWorkspace } from '../core/demoData.ts'
import { templateDraft } from '../core/templates.ts'
import type { DraftRequest, DraftResult, SendRequest, SendResult, Workspace } from '../core/types.ts'

const BASE: string = (import.meta as any).env?.VITE_API_BASE ?? ''

async function call<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(`${BASE}${path}`, { ...init, signal: ctl.signal })
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

export let backendOnline = false

export async function loadWorkspace(): Promise<Workspace> {
  try {
    const ws = await call<Workspace>('/api/workspace', undefined, 8000)
    backendOnline = true
    return ws
  } catch (e) {
    console.warn('[glance] backend unavailable, using built-in demo data', String(e))
    return demoWorkspace()
  }
}

export async function draftReply(req: DraftRequest): Promise<DraftResult> {
  if (!backendOnline) return templateDraft(req)
  try {
    return await call<DraftResult>('/api/draft', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req),
    }, 30_000)
  } catch (e) {
    console.warn('[glance] draft API failed, local template used', String(e))
    return templateDraft(req)
  }
}

export async function transcribe(pcm: Uint8Array): Promise<string> {
  if (!backendOnline || pcm.length < 3200 * 5) return '' // < 0.5 s of audio: treat as no speech
  try {
    const r = await call<{ text: string }>('/api/stt', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm as unknown as BodyInit,
    }, 30_000)
    return (r.text ?? '').trim()
  } catch (e) {
    console.warn('[glance] STT failed', String(e))
    return ''
  }
}

export async function sendReply(req: SendRequest): Promise<SendResult> {
  if (!backendOnline) return { ok: true, mode: 'demo', id: `demo-${Date.now()}` }
  try {
    return await call<SendResult>('/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req),
    })
  } catch (e) {
    return { ok: false, mode: 'demo', error: String(e) }
  }
}
