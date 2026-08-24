import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Privacy-friendly analytics by Plausible. Injected here rather than written
// into index.html so that `apply: 'build'` can keep it out of `npm run dev` —
// a dev session should never show up in the numbers. `window.plausible` is
// therefore undefined in dev, which src/lib/analytics.js accounts for.
//
// hashBasedRouting is required, not optional: routing is `#/show/<slug>` via
// wouter's useHashLocation, and the tracker's default mode only reports a
// pageview when location.pathname changes — which it never does here, so every
// route past the landing page went unrecorded. The flag also sets `h=1` on the
// payload, which is what makes the backend keep the hash instead of collapsing
// every route into one URL; that is why a hand-rolled plausible('pageview')
// call on route change would not have been enough.
const PLAUSIBLE_SRC = 'https://beartown.vadymklymenko.com/js/pa-2ZES4Hbqe40ijj5MYOEHc.js'

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
        'plausible.init({hashBasedRouting:true})',
    },
  ],
})

// Dev is served from a sub-path (https://vadymklymenko.com/aristocrats/), so every
// emitted URL — the entry script, the CSS, everything copied out of public/ — has to
// carry that prefix. The app reads it back through import.meta.env.BASE_URL rather
// than hardcoding it anywhere. For a root deploy: BASE_PATH=/ npm run build.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/aristocrats/',
  plugins: [preact(), plausible()],
  build: { target: 'es2020' },
})
