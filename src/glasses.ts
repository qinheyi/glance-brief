// Even Hub SDK adapter: draws the three text regions on G2 and translates
// touchpad / ring events into gestures for the state machine.
import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { GlanceApp, Io } from './app.ts'
import { LAYOUT, type Screen } from './core/screens.ts'

const IDS = { header: 1, body: 2, footer: 3 } as const

function text(id: number, name: string, r: { x: number; y: number; w: number; h: number }, capture: 0 | 1, color: number) {
  return new TextContainerProperty({
    xPosition: r.x, yPosition: r.y, width: r.w, height: r.h,
    borderWidth: 0, borderColor: 0, paddingLength: LAYOUT.padding,
    containerID: id, containerName: name, content: ' ', isEventCapture: capture, textColor: color,
  })
}

// CLICK_EVENT is 0 and protobuf drops zero values, so a tap arrives with no
// eventType. Resolve the default inside the envelope (see evenhub-templates).
function eventTypeOf(env?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!env) return null
  return env.eventType ?? OsEventTypeList.CLICK_EVENT
}

export async function attachGlasses(bridge: EvenAppBridge, app: GlanceApp): Promise<void> {
  const containers = () => ({
    containerTotalNum: 3,
    textObject: [
      text(IDS.header, 'header', LAYOUT.header, 0, 4),
      text(IDS.body, 'body', LAYOUT.body, 1, 3),
      text(IDS.footer, 'footer', LAYOUT.footer, 0, 2),
    ],
  })
  const res = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers()))
  if (res === 0) console.log('[glance] startup page: success')
  else {
    // The startup page can only be created once per launch (e.g. after a WebView
    // reload); rebuild the same layout instead.
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(containers()))
    console.log(`[glance] startup page exists (${res}); rebuild ${ok ? 'ok' : 'failed'}`)
  }

  let last: Screen = { header: '', body: '', footer: '' }
  let pcmChunks: Uint8Array[] = []
  let listening = false

  const io: Io = {
    async show(s) {
      const upd = async (k: keyof typeof IDS) => {
        if (s[k] === last[k]) return
        await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: IDS[k], containerName: k, content: s[k] || ' ' }))
      }
      await upd('header'); await upd('body'); await upd('footer')
      last = { ...s }
    },
    async micStart() {
      pcmChunks = []
      listening = true
      await bridge.audioControl(true, AudioInputSource.Glasses)
    },
    async micStop() {
      listening = false
      await bridge.audioControl(false)
      const total = pcmChunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let o = 0
      for (const c of pcmChunks) { out.set(c, o); o += c.length }
      pcmChunks = []
      console.log(`[glance] mic captured ${out.length} bytes`)
      return out
    },
    async exit() {
      await bridge.shutDownPageContainer(1)
    },
  }
  app.attach(io)

  bridge.onEvenHubEvent(event => {
    if (event.audioEvent) {
      if (listening && pcmChunks.length < 300) pcmChunks.push(event.audioEvent.audioPcm) // ≤30 s
      return
    }
    if (event.menuItemClickEvent) return
    const sys = eventTypeOf(event.sysEvent)
    const txt = eventTypeOf(event.textEvent)
    const lst = eventTypeOf(event.listEvent)
    const is = (t: OsEventTypeList) => sys === t || txt === t || lst === t
    const g = app.dispatch
    // Explicit ids first; CLICK (the implicit 0) last.
    if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) return g({ type: 'gesture', gesture: 'double' })
    if (is(OsEventTypeList.SCROLL_TOP_EVENT)) return g({ type: 'gesture', gesture: 'up' })
    if (is(OsEventTypeList.SCROLL_BOTTOM_EVENT)) return g({ type: 'gesture', gesture: 'down' })
    if (is(OsEventTypeList.LONG_PRESS_EVENT)) return g({ type: 'gesture', gesture: 'long' })
    if (is(OsEventTypeList.LONG_PRESS_RELEASE_EVENT)) return g({ type: 'gesture', gesture: 'release' })
    if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) return
    if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT || sys === OsEventTypeList.FOREGROUND_EXIT_EVENT) return
    if (sys === OsEventTypeList.IMU_DATA_REPORT) return
    if (is(OsEventTypeList.CLICK_EVENT)) return g({ type: 'gesture', gesture: 'tap' })
  })
}
