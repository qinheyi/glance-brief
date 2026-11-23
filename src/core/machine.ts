// Pure state machine: touchpad gestures in, new state + side effects out.
// Keeping this free of I/O makes every gesture path unit-testable and lets the
// glasses renderer and the browser mirror share exactly the same behaviour.
import type { DraftVariant, Meeting, TriagedEmail, Workspace } from './types.ts'
import { triage } from './triage.ts'

export type Gesture = 'tap' | 'double' | 'up' | 'down' | 'long' | 'release'

export type Mode = 'brief' | 'inbox' | 'listening' | 'drafting' | 'confirm' | 'sending'

export interface DraftTarget {
  emailId: string
  threadId: string
  to: { name: string; email: string }
  subject: string
  snippet: string
  messageIdHeader?: string
  channel?: 'gmail' | 'telegram'
  chatId?: number
  tgMessageId?: number
  returnTo: 'brief' | 'inbox'
}

export interface State {
  mode: Mode
  ws: Workspace
  inbox: TriagedEmail[]
  meetingIdx: number
  emailIdx: number
  target?: DraftTarget
  intent?: string
  variants: DraftVariant[]
  variantIdx: number
  engine?: string
  toast?: string
}

export type Action =
  | { type: 'gesture'; gesture: Gesture }
  | { type: 'transcript'; text: string }
  | { type: 'draftReady'; variants: DraftVariant[]; engine: string }
  | { type: 'draftFailed'; error: string }
  | { type: 'sendDone'; ok: boolean; mode: string; error?: string }
  | { type: 'clearToast' }

export type Effect =
  | { type: 'micStart' }
  | { type: 'micStopAndDraft'; target: DraftTarget }
  | { type: 'send'; target: DraftTarget; body: string }
  | { type: 'exit' }

export interface Step {
  state: State
  effects: Effect[]
}

export function initState(ws: Workspace, now: Date = new Date()): State {
  const meetings = upcoming(ws.meetings, now)
  return {
    mode: 'brief',
    ws: { ...ws, meetings },
    inbox: triage(ws.emails, ws.vips, meetings, now),
    meetingIdx: 0,
    emailIdx: 0,
    variants: [],
    variantIdx: 0,
  }
}

function upcoming(meetings: Meeting[], now: Date): Meeting[] {
  return meetings
    .filter(m => new Date(m.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

export function openEmails(s: State): TriagedEmail[] {
  return s.inbox.filter(e => !e.handled)
}

function targetFromEmail(e: TriagedEmail, returnTo: DraftTarget['returnTo']): DraftTarget {
  return {
    emailId: e.id, threadId: e.threadId, to: e.from, subject: e.subject,
    snippet: e.snippet, messageIdHeader: e.messageIdHeader, returnTo,
    channel: e.channel ?? 'gmail', chatId: e.chatId, tgMessageId: e.tgMessageId,
  }
}

function currentTarget(s: State): DraftTarget | undefined {
  if (s.mode === 'inbox') {
    const e = openEmails(s)[s.emailIdx]
    return e ? targetFromEmail(e, 'inbox') : undefined
  }
  if (s.mode === 'brief') {
    const m = s.ws.meetings[s.meetingIdx]
    if (!m) return undefined
    const e = s.inbox.find(x => x.threadId === m.relatedThreadId && !x.handled)
    if (e) return targetFromEmail(e, 'brief')
    const who = m.attendees[0]
    if (!who) return undefined
    return {
      emailId: `meeting-${m.id}`, threadId: '', to: who, subject: m.title,
      snippet: `Upcoming meeting "${m.title}". Context: ${m.context.join('; ')}`, returnTo: 'brief',
    }
  }
  return undefined
}

export function reduce(s: State, a: Action): Step {
  const none = (state: State): Step => ({ state, effects: [] })

  switch (a.type) {
    case 'clearToast':
      return none({ ...s, toast: undefined })
    case 'transcript':
      return none({ ...s, intent: a.text })
    case 'draftReady':
      if (s.mode !== 'drafting') return none(s)
      return none({ ...s, mode: 'confirm', variants: a.variants, variantIdx: 0, engine: a.engine })
    case 'draftFailed':
      if (s.mode !== 'drafting') return none(s)
      return none({ ...s, mode: s.target?.returnTo ?? 'inbox', target: undefined, toast: `Draft failed: ${a.error}` })
    case 'sendDone': {
      if (s.mode !== 'sending') return none(s)
      const back = s.target?.returnTo ?? 'inbox'
      if (!a.ok) return none({ ...s, mode: 'confirm', toast: `Send failed: ${a.error ?? 'unknown'}` })
      const inbox = s.inbox.map(e => (e.id === s.target?.emailId ? { ...e, handled: 'replied' as const } : e))
      const left = inbox.filter(e => !e.handled).length
      const next: State = {
        ...s, inbox, mode: back, target: undefined, variants: [], intent: undefined,
        emailIdx: Math.min(s.emailIdx, Math.max(0, left - 1)),
        toast: a.mode === 'demo' ? `Sent (demo) · ${left} left` : `Sent via ${a.mode === 'telegram' ? 'Telegram' : 'Gmail'} · ${left} left`,
      }
      return none(next)
    }
    case 'gesture':
      return onGesture(s, a.gesture)
  }
}

function onGesture(s: State, g: Gesture): Step {
  const none = (state: State): Step => ({ state, effects: [] })
  const st = { ...s, toast: undefined }

  switch (s.mode) {
    case 'brief':
    case 'inbox': {
      if (g === 'tap') {
        // Single tap = next meeting brief. From the inbox it jumps back to the brief.
        if (s.mode === 'inbox') return none({ ...st, mode: 'brief' })
        const n = s.ws.meetings.length
        return none({ ...st, meetingIdx: n ? (s.meetingIdx + 1) % n : 0 })
      }
      if (g === 'up' || g === 'down') {
        const n = openEmails(s).length
        if (s.mode === 'brief') return none({ ...st, mode: 'inbox', emailIdx: 0 })
        if (!n) return none(st)
        const d = g === 'down' ? 1 : -1
        return none({ ...st, emailIdx: (s.emailIdx + d + n) % n })
      }
      if (g === 'long') {
        const target = currentTarget(s)
        if (!target) return none({ ...st, toast: 'Nothing to reply to' })
        return { state: { ...st, mode: 'listening', target, intent: undefined }, effects: [{ type: 'micStart' }] }
      }
      if (g === 'double') {
        if (s.mode === 'inbox') return none({ ...st, mode: 'brief' })
        return { state: st, effects: [{ type: 'exit' }] }
      }
      return none(s)
    }
    case 'listening': {
      if (g === 'release' || g === 'tap') {
        return { state: { ...st, mode: 'drafting' }, effects: [{ type: 'micStopAndDraft', target: s.target! }] }
      }
      if (g === 'double') return none({ ...st, mode: s.target?.returnTo ?? 'inbox', target: undefined, toast: 'Cancelled' })
      return none(s)
    }
    case 'drafting': {
      if (g === 'double') return none({ ...st, mode: s.target?.returnTo ?? 'inbox', target: undefined, toast: 'Discarded' })
      return none(s)
    }
    case 'confirm': {
      if (g === 'tap') {
        const v = s.variants[s.variantIdx]
        return { state: { ...st, mode: 'sending' }, effects: [{ type: 'send', target: s.target!, body: v.body }] }
      }
      if (g === 'double') {
        return none({ ...st, mode: s.target?.returnTo ?? 'inbox', target: undefined, variants: [], toast: 'Discarded · nothing sent' })
      }
      if (g === 'up' || g === 'down') {
        const n = s.variants.length || 1
        const d = g === 'down' ? 1 : -1
        return none({ ...st, variantIdx: (s.variantIdx + d + n) % n })
      }
      return none(s)
    }
    case 'sending':
      return none(s)
  }
}
