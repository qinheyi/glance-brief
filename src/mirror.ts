// Browser mirror of the glasses display. Runs on the phone companion page and as
// the standalone web preview (no glasses / no simulator needed).
import type { GlanceApp, Io } from './app.ts'
import type { Gesture } from './core/machine.ts'
import type { Screen } from './core/screens.ts'

export function attachMirror(app: GlanceApp, root: HTMLElement, interactive: boolean): void {
  root.innerHTML = `
    <div class="g2" aria-label="G2 display mirror (576×288)">
      <pre class="hdr"></pre><pre class="body"></pre><pre class="ftr"></pre>
    </div>
    <div class="pad" ${interactive ? '' : 'hidden'}>
      <button data-g="tap">Tap</button>
      <button data-g="double">Double tap</button>
      <button data-g="up">Swipe ↑</button>
      <button data-g="down">Swipe ↓</button>
      <button data-g="long" class="hold">Hold (long press)</button>
    </div>
    <p class="keys" ${interactive ? '' : 'hidden'}>Keys: Space = tap · D = double tap · ↑/↓ = swipe · hold L = long press</p>`
  const hdr = root.querySelector('.hdr') as HTMLElement
  const body = root.querySelector('.body') as HTMLElement
  const ftr = root.querySelector('.ftr') as HTMLElement

  const io: Io = {
    show(s: Screen) { hdr.textContent = s.header; body.textContent = s.body; ftr.textContent = s.footer },
    async micStart() {},
    async micStop() { return new Uint8Array() },
    exit() { hdr.textContent = '(app closed — reload to restart)'; body.textContent = ''; ftr.textContent = '' },
  }
  app.attach(io)
  if (!interactive) return

  const fire = (gesture: Gesture) => app.dispatch({ type: 'gesture', gesture })
  root.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach(b => {
    const g = b.dataset.g as Gesture
    if (g === 'long') {
      b.addEventListener('pointerdown', () => fire('long'))
      b.addEventListener('pointerup', () => fire('release'))
    } else b.addEventListener('click', () => fire(g))
  })
  let lHeld = false
  window.addEventListener('keydown', e => {
    if (e.repeat) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fire('tap') }
    else if (e.key === 'd' || e.key === 'D') fire('double')
    else if (e.key === 'ArrowUp') { e.preventDefault(); fire('up') }
    else if (e.key === 'ArrowDown') { e.preventDefault(); fire('down') }
    else if ((e.key === 'l' || e.key === 'L') && !lHeld) { lHeld = true; fire('long') }
  })
  window.addEventListener('keyup', e => {
    if ((e.key === 'l' || e.key === 'L') && lHeld) { lHeld = false; fire('release') }
  })
}
