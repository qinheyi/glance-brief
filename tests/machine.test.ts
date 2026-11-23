import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoWorkspace } from '../src/core/demoData.ts'
import { initState, openEmails, reduce, type Action, type State } from '../src/core/machine.ts'
import { render } from '../src/core/screens.ts'
import { triage } from '../src/core/triage.ts'

const NOW = new Date('2026-11-24T09:00:00Z')
const tap: Action = { type: 'gesture', gesture: 'tap' }
const g = (gesture: any): Action => ({ type: 'gesture', gesture })

function run(s: State, ...as: Action[]) {
  let effects: any[] = []
  for (const a of as) { const r = reduce(s, a); s = r.state; effects = r.effects }
  return { s, effects }
}

test('starts on the brief for the next meeting', () => {
  const s = initState(demoWorkspace(NOW), NOW)
  assert.equal(s.mode, 'brief')
  assert.equal(s.ws.meetings[0].id, 'm1')
  assert.match(render(s, NOW).header, /^NEXT IN 12 MIN/)
})

test('tap cycles through meeting briefs', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const { s } = run(s0, tap, tap)
  assert.equal(s.meetingIdx, 2)
  assert.equal(run(s, tap).s.meetingIdx, 0)
})

test('swipe opens inbox sorted by urgency and moves through cards', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const { s } = run(s0, g('down'))
  assert.equal(s.mode, 'inbox')
  assert.equal(openEmails(s)[0].id, 'e1') // VIP + due today + meeting soon
  assert.equal(openEmails(s).at(-1)!.id, 'e5') // newsletter last
  assert.equal(run(s, g('down')).s.emailIdx, 1)
  assert.equal(run(s, g('up')).s.emailIdx, openEmails(s).length - 1)
})

test('triage scores are explainable', () => {
  const ws = demoWorkspace(NOW)
  const t = triage(ws.emails, ws.vips, ws.meetings, NOW)
  assert.deepEqual(t[0].reasons.slice(0, 3), ['VIP', 'due today', 'meeting soon'])
  assert.ok(t.find(e => e.id === 'e5')!.reasons.includes('newsletter'))
})

test('long press → listen → draft → confirm requires an explicit tap to send', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  let r = run(s0, g('down'), g('long'))
  assert.equal(r.s.mode, 'listening')
  assert.deepEqual(r.effects, [{ type: 'micStart' }])
  r = run(r.s, g('release'))
  assert.equal(r.s.mode, 'drafting')
  assert.equal(r.effects[0].type, 'micStopAndDraft')
  r = run(r.s, { type: 'draftReady', engine: 'template', variants: [{ label: 'Reply', body: 'Hi Maya, yes.' }, { label: 'Short', body: 'On it.' }] })
  assert.equal(r.s.mode, 'confirm')
  assert.deepEqual(r.effects, []) // nothing is sent before the tap
  const alt = run(r.s, g('down'))
  assert.equal(alt.s.variantIdx, 1)
  const sent = run(alt.s, tap)
  assert.deepEqual(sent.effects[0], { type: 'send', target: r.s.target, body: 'On it.' })
  const done = run(sent.s, { type: 'sendDone', ok: true, mode: 'demo' })
  assert.equal(done.s.mode, 'inbox')
  assert.equal(openEmails(done.s).length, 6)
  assert.match(done.s.toast!, /Sent \(demo\) · 6 left/)
})

test('double tap on a draft discards it and sends nothing', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const r = run(s0, g('down'), g('long'), g('release'), { type: 'draftReady', engine: 'template', variants: [{ label: 'Reply', body: 'x' }] }, g('double'))
  assert.equal(r.s.mode, 'inbox')
  assert.deepEqual(r.effects, [])
  assert.equal(openEmails(r.s).length, 7)
  assert.match(r.s.toast!, /nothing sent/)
})

test('long press on a brief replies to the related thread', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const r = run(s0, g('long'))
  assert.equal(r.s.target?.threadId, 't1')
  assert.equal(r.s.target?.returnTo, 'brief')
})

test('gestures are ignored while sending (no double send)', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const r = run(s0, g('down'), g('long'), g('release'), { type: 'draftReady', engine: 't', variants: [{ label: 'Reply', body: 'x' }] }, tap)
  assert.equal(r.s.mode, 'sending')
  assert.deepEqual(run(r.s, tap).effects, [])
})

test('every screen fits the display: ≤7 body lines, single-line header/footer', () => {
  const s0 = initState(demoWorkspace(NOW), NOW)
  const states = [s0, run(s0, tap).s, run(s0, g('down')).s, run(s0, g('down'), g('long')).s,
    run(s0, g('down'), g('long'), g('release'), { type: 'draftReady', engine: 't', variants: [{ label: 'Reply', body: 'word '.repeat(120) }] }).s]
  for (const s of states) {
    const scr = render(s, NOW)
    assert.ok(scr.body.split('\n').length <= 7, `${s.mode} body too tall`)
    assert.ok(!scr.header.includes('\n') && !scr.footer.includes('\n'))
  }
})
