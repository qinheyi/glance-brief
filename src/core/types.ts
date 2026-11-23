// Shared domain types for Glance Brief.

export interface Person {
  name: string
  email: string
}

export interface Meeting {
  id: string
  title: string
  start: string // ISO timestamp
  end: string
  location?: string
  attendees: Person[]
  /** Short context lines distilled from recent email threads with attendees. */
  context: string[]
  /** Open action items the user owes before / in this meeting. */
  todos: string[]
  /** Gmail thread most related to this meeting (used for long-press replies). */
  relatedThreadId?: string
}

export interface Email {
  id: string
  threadId: string
  from: Person
  subject: string
  snippet: string
  receivedAt: string // ISO timestamp
  labels: string[]
  /** Message-ID header, used for In-Reply-To when replying through Gmail. */
  messageIdHeader?: string
  /** Where the item came from. Defaults to Gmail. */
  channel?: 'gmail' | 'telegram'
  /** Telegram chat + message ids (channel === 'telegram'). */
  chatId?: number
  tgMessageId?: number
}

export interface TriagedEmail extends Email {
  score: number
  reasons: string[]
  handled?: 'replied' | 'skipped'
}

export interface Workspace {
  source: 'demo' | 'google' | 'mixed'
  user: Person
  meetings: Meeting[]
  emails: Email[]
  vips: string[]
}

export interface DraftRequest {
  to: Person
  subject: string
  threadSnippet: string
  /** Optional spoken intent (speech-to-text of the long press). */
  intent?: string
  userName: string
  channel?: 'gmail' | 'telegram'
}

export interface DraftVariant {
  label: string // e.g. "Reply", "Short", "Decline"
  body: string
}

export interface DraftResult {
  variants: DraftVariant[]
  engine: 'minimax' | 'openrouter' | 'template'
}

export interface SendRequest {
  threadId: string
  to: Person
  subject: string
  body: string
  inReplyTo?: string
  channel?: 'gmail' | 'telegram'
  chatId?: number
  replyToMessageId?: number
  confirmed: true
}

export interface SendResult {
  ok: boolean
  mode: 'demo' | 'gmail' | 'telegram'
  id?: string
  error?: string
}
