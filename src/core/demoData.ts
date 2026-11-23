// DEMO DATA — fictional people, companies and emails used for the hackathon
// demo and the simulator. Nothing here is real user data. Times are generated
// relative to "now" so the next meeting is always upcoming.
import type { Workspace } from './types.ts'

function at(base: Date, minutesFromNow: number): string {
  return new Date(base.getTime() + minutesFromNow * 60_000).toISOString()
}

export function demoWorkspace(now: Date = new Date()): Workspace {
  const me = { name: 'Qin Heyi', email: 'me@demo.glance' }
  const maya = { name: 'Maya Chen', email: 'maya@acme-robotics.demo' }
  const leo = { name: 'Leo Park', email: 'leo@acme-robotics.demo' }
  const sara = { name: 'Sara Okafor', email: 'sara@northwind.demo' }
  const tom = { name: 'Tom Weber', email: 'tom@finance.demo' }
  const ana = { name: 'Ana Ruiz', email: 'ana@designco.demo' }

  return {
    source: 'demo',
    user: me,
    vips: [maya.email, sara.email],
    meetings: [
      {
        id: 'm1',
        title: 'Pilot review · Acme Robotics',
        start: at(now, 12),
        end: at(now, 42),
        location: 'Zoom',
        attendees: [maya, leo],
        context: [
          'Maya: pilot ends Fri, wants go/no-go',
          'Leo: 2 bugs open on the sync API',
          'Last call: price agreed at $18/seat',
        ],
        todos: ['Bring rollout date', 'Confirm bug-fix ETA'],
        relatedThreadId: 't1',
      },
      {
        id: 'm2',
        title: 'Design crit · onboarding v2',
        start: at(now, 95),
        end: at(now, 125),
        location: 'Room 3B',
        attendees: [ana],
        context: ['Ana sent 3 flows, prefers flow B', 'Open: skip-login for guests?'],
        todos: ['Pick one flow'],
        relatedThreadId: 't4',
      },
      {
        id: 'm3',
        title: 'Budget check-in · Q1',
        start: at(now, 240),
        end: at(now, 260),
        location: 'Google Meet',
        attendees: [tom],
        context: ['Tom needs Q1 tool spend by today', 'Last month: 4% over plan'],
        todos: ['Send the spend sheet'],
        relatedThreadId: 't3',
      },
    ],
    emails: [
      {
        id: 'e1', threadId: 't1', from: maya,
        subject: 'Go/no-go for the pilot?',
        snippet: 'Hi! Before our call — can you confirm we can roll out to all 40 seats next Monday? Need a yes today for procurement.',
        receivedAt: at(now, -25), labels: ['INBOX', 'UNREAD', 'IMPORTANT'],
      },
      {
        id: 'e2', threadId: 't2', from: sara,
        subject: 'Contract redlines — need by 5pm',
        snippet: 'Legal sent two redlines on clause 7. Are you OK with 30-day termination? Deadline 5pm today.',
        receivedAt: at(now, -70), labels: ['INBOX', 'UNREAD'],
      },
      {
        id: 'e3', threadId: 't3', from: tom,
        subject: 'Q1 tool spend',
        snippet: 'Could you send the Q1 tool spend before our check-in? A rough number is fine.',
        receivedAt: at(now, -140), labels: ['INBOX', 'UNREAD'],
      },
      {
        id: 'e4', threadId: 't4', from: ana,
        subject: 'Onboarding flows A/B/C',
        snippet: 'Attached the three flows. I lean towards B. Thoughts before the crit?',
        receivedAt: at(now, -200), labels: ['INBOX'],
      },
      {
        id: 'tg1', threadId: 'tg-chat-1', channel: 'telegram', chatId: 0, tgMessageId: 0, // demo: never sent
        from: { name: 'Leo Park', email: 'telegram:leo_park' },
        subject: 'Telegram · Acme pilot group',
        snippet: 'Staging is green again. Can we tell Maya today that the sync fix ships Thursday?',
        receivedAt: at(now, -10), labels: ['INBOX', 'UNREAD'],
      },
      {
        id: 'e5', threadId: 't5', from: { name: 'Product Weekly', email: 'news@productweekly.demo' },
        subject: 'This week in product: 12 links',
        snippet: 'The best reads of the week on onboarding, pricing and retention.',
        receivedAt: at(now, -300), labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
      },
      {
        id: 'e6', threadId: 't6', from: leo,
        subject: 'Sync API bug #212 fixed?',
        snippet: 'Pushed a fix for #212 to staging. Can you verify when you have a minute?',
        receivedAt: at(now, -45), labels: ['INBOX', 'UNREAD'],
      },
    ],
  }
}
