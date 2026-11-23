// Wires the pure state machine to I/O: backend calls, microphone, rendering.
import { initState, reduce, type Action, type Effect, type State } from './core/machine.ts'
import { render, type Screen } from './core/screens.ts'
import type { Workspace } from './core/types.ts'
import { draftReply, sendReply, transcribe } from './services/api.ts'

export interface Io {
  show(screen: Screen): Promise<void> | void
  micStart(): Promise<void>
  micStop(): Promise<Uint8Array>
  exit(): Promise<void> | void
}

export class GlanceApp {
  state: State
  private ios: Io[] = []
  private toastTimer?: ReturnType<typeof setTimeout>

  constructor(ws: Workspace) {
    this.state = initState(ws)
  }

  attach(io: Io) {
    this.ios.push(io)
    io.show(render(this.state))
  }

  dispatch = (a: Action) => {
    const { state, effects } = reduce(this.state, a)
    this.state = state
    if (a.type === 'gesture') console.log(`[glance] gesture=${a.gesture} mode=${state.mode}`)
    for (const io of this.ios) io.show(render(state))
    if (state.toast) {
      clearTimeout(this.toastTimer)
      this.toastTimer = setTimeout(() => this.dispatch({ type: 'clearToast' }), 2500)
    }
    for (const e of effects) void this.run(e)
  }

  private get primary(): Io {
    return this.ios[0]
  }

  private async run(e: Effect) {
    switch (e.type) {
      case 'micStart':
        await this.primary.micStart().catch(err => console.warn('[glance] mic start failed', String(err)))
        return
      case 'micStopAndDraft': {
        let pcm: Uint8Array = new Uint8Array()
        try { pcm = await this.primary.micStop() } catch (err) { console.warn('[glance] mic stop failed', String(err)) }
        const intent = await transcribe(pcm)
        this.dispatch({ type: 'transcript', text: intent })
        const r = await draftReply({
          to: e.target.to, subject: e.target.subject, threadSnippet: e.target.snippet,
          intent: intent || undefined, userName: this.state.ws.user.name, channel: e.target.channel,
        })
        console.log(`[glance] draft engine=${r.engine} variants=${r.variants.length}`)
        this.dispatch({ type: 'draftReady', variants: r.variants, engine: r.engine })
        return
      }
      case 'send': {
        // Write path: only reachable from the confirm screen after an explicit tap.
        const r = await sendReply({
          threadId: e.target.threadId, to: e.target.to, subject: e.target.subject,
          body: e.body, inReplyTo: e.target.messageIdHeader, confirmed: true,
          channel: e.target.channel, chatId: e.target.chatId, replyToMessageId: e.target.tgMessageId,
        })
        console.log(`[glance] send ok=${r.ok} mode=${r.mode}`)
        this.dispatch({ type: 'sendDone', ok: r.ok, mode: r.mode, error: r.error })
        return
      }
      case 'exit':
        await this.primary.exit()
        return
    }
  }
}
