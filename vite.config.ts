import { defineConfig } from 'vite'

// The backend (npm run server) listens on :8787; Vite proxies /api so the
// WebView only ever talks to one origin and never sees an API key.
export default defineConfig({
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:8787', '/auth': 'http://localhost:8787' } },
  build: { target: 'esnext' },
})
