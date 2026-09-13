import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Privacy-friendly analytics by Plausible. Injected here rather than written
// into index.html so that `apply: 'build'` can keep it out of `npm run dev` —
// a dev session should never show up in the numbers. `window.plausible` is
// therefore undefined in dev, which src/lib/track.js accounts for. Routes are
// real paths (`/show/<slug>`), so the tracker's default pathname mode is enough.
const PLAUSIBLE_SRC = 'https://beartown.vadymklymenko.com/js/pa-Il2qsxEUkuDeoMA48acvq.js'

const plausible = () => ({
  name: 'plausible-analytics',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'script', attrs: { async: true, src: PLAUSIBLE_SRC }, injectTo: 'head' },
    {
      tag: 'script',
      injectTo: 'head',
      children:
        'window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},' +
        'plausible.init=plausible.init||function(i){plausible.o=i||{}};' +
        'plausible.init()',
    },
  ],
})

// Served from the site root. Every emitted URL — the entry script, the CSS,
// everything copied out of public/ — is built from import.meta.env.BASE_URL
// rather than hardcoded. For a sub-path deploy: BASE_PATH=/aristocrats/ npm run build.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact(), plausible()],
  build: { target: 'es2020' },
})
