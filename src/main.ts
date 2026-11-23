import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { GlanceApp } from './app.ts'
import { attachGlasses } from './glasses.ts'
import { attachMirror } from './mirror.ts'
import { backendOnline, loadWorkspace } from './services/api.ts'

function hasHost(): boolean {
  return typeof (window as any).flutter_inappwebview?.callHandler === 'function'
}

async function bridgeOrNull(ms: number): Promise<EvenAppBridge | null> {
  // Outside the Even App / simulator there is no native host: the SDK would still
  // hand out a bridge object, so detect the host handler first (it may be
  // injected shortly after load) and fall back to the browser mirror.
  const t0 = Date.now()
  while (!hasHost() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50))
  if (!hasHost()) return null
  const timeout = new Promise<null>(r => setTimeout(() => r(null), 4000))
  return Promise.race([waitForEvenAppBridge(), timeout])
}

async function boot() {
  const status = document.getElementById('status')!
  const ws = await loadWorkspace()
  const app = new GlanceApp(ws)
  const bridge = await bridgeOrNull(1500)

  if (bridge) await attachGlasses(bridge, app)
  attachMirror(app, document.getElementById('mirror')!, !bridge)

  status.textContent = [
    bridge ? 'Connected to G2 / simulator' : 'Web preview (no glasses): use the buttons or keys',
    ws.source === 'demo' ? 'Data: built-in DEMO data (fictional)' : 'Data: your Google Workspace',
    backendOnline ? 'Backend: online' : 'Backend: offline → local templates, demo send',
  ].join(' · ')
  ;(window as any).glance = app // handy for debugging in the inspector
}

boot().catch(e => {
  console.error('[glance] boot failed', e)
  const s = document.getElementById('status')
  if (s) s.textContent = `Boot failed: ${String(e)}`
})
