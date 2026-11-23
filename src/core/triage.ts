// Deterministic, explainable urgency scoring for the inbox stack.
import type { Email, Meeting, TriagedEmail } from './types.ts'

const URGENT_WORDS = /\b(today|asap|urgent|deadline|by \d{1,2}(:\d{2})?\s?(am|pm)|eod|need a yes|need by)\b/i
const QUESTION = /\?/
const LOW_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES']

export function triage(emails: Email[], vips: string[], meetings: Meeting[], now: Date = new Date()): TriagedEmail[] {
  const soonAttendees = new Set(
    meetings
      .filter(m => new Date(m.start).getTime() - now.getTime() < 3 * 3600_000)
      .flatMap(m => m.attendees.map(a => a.email.toLowerCase())),
  )
  return emails
    .map(e => {
      let score = 0
      const reasons: string[] = []
      const text = `${e.subject} ${e.snippet}`
      if (vips.includes(e.from.email.toLowerCase())) { score += 30; reasons.push('VIP') }
      if (URGENT_WORDS.test(text)) { score += 35; reasons.push('due today') }
      if (soonAttendees.has(e.from.email.toLowerCase())) { score += 20; reasons.push('meeting soon') }
      if (QUESTION.test(text)) { score += 10; reasons.push('asks you') }
      if (e.labels.includes('UNREAD')) score += 5
      if (e.labels.includes('IMPORTANT')) score += 5
      if (e.labels.some(l => LOW_LABELS.includes(l))) { score -= 40; reasons.push('newsletter') }
      const ageH = (now.getTime() - new Date(e.receivedAt).getTime()) / 3600_000
      score -= Math.min(10, Math.max(0, ageH)) // fresher first among equals
      return { ...e, score: Math.round(score), reasons }
    })
    .sort((a, b) => b.score - a.score)
}

export function urgencyTag(score: number): string {
  if (score >= 60) return 'URGENT'
  if (score >= 25) return 'SOON'
  return 'LATER'
}
