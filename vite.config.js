import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SITE_ORIGIN,
  applyPage,
  homePage,
  settingsPage,
  showPage,
} from './src/lib/page-meta.js'

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

const siteOrigin = () =>
  (process.env.SITE_ORIGIN ?? process.env.VITE_SITE_ORIGIN ?? SITE_ORIGIN).replace(/\/$/, '')

// Facebook / Telegram / Slack fetch the URL and do not run JS, so a shared
// `/show/<slug>` would otherwise always unfurl as the homepage (nginx
// try_files falls unknown paths back to index.html). The same shell is
// copied under each route with that page's tags; try_files $uri/ then
// serves `show/<slug>/index.html` first.
const socialMeta = () => {
  let base = '/'
  let outDir = 'dist'
  const covers = new Map()

  const recordCovers = (bundle) => {
    for (const output of Object.values(bundle)) {
      if (output.type !== 'asset') continue
      if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(output.fileName)) continue
      const originals = [
        ...(output.originalFileNames ?? []),
        ...(output.names ?? []),
        output.name,
      ].filter(Boolean)
      for (const orig of originals) {
        const filename = String(orig).split(/[\\/]/).pop()
        if (filename) covers.set(filename, output.fileName)
      }
    }
  }

  const write = (dist, relative, html) => {
    const file = join(dist, relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, html)
  }

  return {
    name: 'social-meta',
    configResolved(config) {
      base = config.base
      outDir = config.build.outDir
    },
    transformIndexHtml(html) {
      return applyPage(html, homePage(siteOrigin(), base))
    },
    generateBundle(_, bundle) {
      recordCovers(bundle)
    },
    writeBundle({ dir }) {
      const dist = dir ?? outDir
      const origin = siteOrigin()
      const html = readFileSync(join(dist, 'index.html'), 'utf8')
      const index = JSON.parse(readFileSync(join(dist, 'data', 'index.json'), 'utf8'))

      write(dist, join('settings', 'index.html'), applyPage(html, settingsPage(origin, base)))

      let shows = 0
      for (const show of index.shows) {
        if (!/^[a-z0-9-]+$/i.test(show.slug)) continue
        const cover = show.img ? covers.get(show.img) : null
        write(
          dist,
          join('show', show.slug, 'index.html'),
          applyPage(html, showPage(show, origin, base, cover)),
        )
        shows++
      }
      console.log(`social meta         ${shows} shows + settings`)
    },
  }
}

// Served from the site root. Every emitted URL — the entry script, the CSS,
// everything copied out of public/ — is built from import.meta.env.BASE_URL
// rather than hardcoded. For a sub-path deploy: BASE_PATH=/aristocrats/ npm run build.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact(), plausible(), socialMeta()],
  build: { target: 'es2020' },
})
