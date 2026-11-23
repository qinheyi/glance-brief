// Turns state into the three text regions shown on the 576×288 G2 display.
// Every line is measured with @evenrealities/pretext (the glyph metrics used by
// the G2 firmware) so nothing wraps or clips unexpectedly on the glasses.
import { measureTextWrap, pxTruncate } from '@evenrealities/pretext'
import type { State } from './machine.ts'
import { openEmails } from './machine.ts'
import { urgencyTag } from './triage.ts'

export const LAYOUT = {
  width: 576,
  height: 288,
  header: { x: 0, y: 0, w: 576, h: 40 },
  body: { x: 0, y: 40, w: 576, h: 208 },
  footer: { x: 0, y: 248, w: 576, h: 40 },
  padding: 6,
  lineHeight: 27,
}

const INNER_W = LAYOUT.width - LAYOUT.padding * 2 - 4
const BODY_LINES = Math.floor((LAYOUT.body.h - LAYOUT.padding * 2) / LAYOUT.lineHeight) // 7

export interface Screen {
  header: string
  body: string
  footer: string
}

export function oneLine(text: string, maxPx = INNER_W): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return pxTruncate(t, maxPx)
}

/** Word-wraps `text` and keeps at most `maxLines` lines, ending with an ellipsis if cut. */
export function clamp(text: string, maxLines: number, maxPx = INNER_W): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w
    if (measureTextWrap(cand, maxPx).lineCount > 1 && cur) {
      lines.push(cur)
      cur = w
    } else cur = cand
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines.map(l => pxTruncate(l, maxPx))
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = pxTruncate(`${kept[maxLines - 1]}…`, maxPx)
  if (!kept[maxLines - 1].endsWith('…')) kept[maxLines - 1] = pxTruncate(kept[maxLines - 1], maxPx - 20) + '…'
  return kept
}

/** Like clamp() but keeps paragraph breaks (greeting / body / sign-off). */
export function clampParas(text: string, maxLines: number, maxPx = INNER_W): string[] {
  const paras = text.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of paras) {
    const room = maxLines - out.length
    if (room <= 0) break
    const lines = clamp(p, room, maxPx)
    out.push(...lines)
  }
  if (paras.length && out.length >= maxLines) {
    const all = paras.reduce((n, p) => n + clamp(p, 99, maxPx).length, 0)
    if (all > maxLines && !out[maxLines - 1].endsWith('…')) out[maxLines - 1] = pxTruncate(out[maxLines - 1], maxPx - 20) + '…'
  }
  return out.slice(0, maxLines)
}

function rel(iso: string, now: Date): string {
  const mins = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000)
  if (mins <= 0 && mins > -60) return 'NOW'
  if (Math.abs(mins) < 60) return mins > 0 ? `in ${mins} min` : `${-mins} min ago`
  const h = Math.round(Math.abs(mins) / 60)
  return mins > 0 ? `in ${h} h` : `${h} h ago`
}

function age(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function first(name: string): string {
  return name.split(/\s+/)[0]
}

export function render(s: State, now: Date = new Date()): Screen {
  const demo = s.ws.source === 'demo' ? ' · DEMO' : ''
  const scr = renderMode(s, now, demo)
  if (s.toast) scr.header = oneLine(`» ${s.toast}`)
  return scr
}

function renderMode(s: State, now: Date, demo: string): Screen {
  switch (s.mode) {
    case 'brief': {
      const m = s.ws.meetings[s.meetingIdx]
      if (!m) return { header: oneLine(`NO MORE MEETINGS TODAY${demo}`), body: 'Calendar is clear.\nSwipe for inbox.', footer: 'swipe inbox · 2x exit' }
      const n = s.ws.meetings.length
      const lines = [
        ...clamp(m.title, 1),
        oneLine(`With ${m.attendees.map(a => a.name).join(', ')}`),
        ...m.context.slice(0, 3).map(c => oneLine(`• ${c}`)),
        ...(m.todos.length ? [oneLine(`TODO ${m.todos.join(' · ')}`)] : []),
      ].slice(0, BODY_LINES)
      return {
        header: oneLine(`NEXT ${rel(m.start, now).toUpperCase()} · ${hhmm(m.start)} · ${m.location ?? ''} · ${s.meetingIdx + 1}/${n}${demo}`),
        body: lines.join('\n'),
        footer: oneLine('tap next · swipe inbox · hold reply'),
      }
    }
    case 'inbox': {
      const open = openEmails(s)
      const e = open[s.emailIdx]
      if (!e) return { header: oneLine(`INBOX ZERO${demo}`), body: 'All caught up.\nTap for your next meeting.', footer: 'tap brief · 2x back' }
      const lines = [
        oneLine(`${e.from.name} · ${age(e.receivedAt, now)} ago`),
        ...clamp(e.subject, 1),
        ...clamp(e.snippet, 3),
        oneLine(`why: ${e.reasons.join(' · ') || 'recent'}`),
      ]
      return {
        header: oneLine(`INBOX ${s.emailIdx + 1}/${open.length} · ${urgencyTag(e.score)}${e.channel === 'telegram' ? ' · TELEGRAM' : ''}${demo}`),
        body: lines.slice(0, BODY_LINES).join('\n'),
        footer: oneLine('swipe next · hold reply · tap brief'),
      }
    }
    case 'listening':
      return {
        header: oneLine(`REPLY TO ${first(s.target?.to.name ?? '').toUpperCase()} · LISTENING`),
        body: [...clamp(`Re: ${s.target?.subject ?? ''}`, 1), '', 'Say your reply, e.g. "yes, Monday works".', 'Or just let go: AI drafts a smart default.'].join('\n'),
        footer: oneLine('release = draft · 2x cancel'),
      }
    case 'drafting':
      return {
        header: oneLine(`DRAFTING FOR ${first(s.target?.to.name ?? '').toUpperCase()}…`),
        body: [
          ...(s.intent === undefined ? ['Got it. Transcribing…'] : s.intent ? clamp(`Heard: "${s.intent}"`, 2) : ['No speech: AI picks a smart default.']),
          '', 'Writing a short reply…',
        ].join('\n'),
        footer: oneLine('2x cancel'),
      }
    case 'confirm': {
      const v = s.variants[s.variantIdx]
      return {
        header: oneLine(`DRAFT ${s.variantIdx + 1}/${s.variants.length} · ${v?.label ?? ''} → ${s.target?.to.name ?? ''}${s.engine === 'template' ? '' : ' · AI'}`),
        body: [oneLine(`Re: ${s.target?.subject ?? ''}`), ...clampParas(v?.body ?? '', BODY_LINES - 1)].join('\n'),
        footer: oneLine('tap SEND · 2x discard · swipe alt'),
      }
    }
    case 'sending':
      return { header: oneLine(`SENDING TO ${first(s.target?.to.name ?? '').toUpperCase()}…`), body: 'Confirmed by tap.\nSending…', footer: '' }
  }
}
