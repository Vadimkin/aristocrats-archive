// Exports db/aristocrats.db into the small chunks the site loads lazily:
//   public/data/index.json          — 148 shows, era-grouped
//   public/data/shows/<slug>.json   — episodes of one show
//   public/data/search.json         — flat haystack for global episode search
//
// Pure query and serialization: the filename parsing that used to live here
// now runs once in import-tracks.mjs. The v_* views already layer
// `show_overrides` over the derived columns, so this reads them as plain
// tables and never needs to know overrides exist.
//
// Three things about the output shape are load-bearing and easy to break:
//   - `id` is the localStorage key for every played-mark and resume position
//     in every browser that has loaded the site. It is copied, never derived.
//   - An empty `t` is a real value: the row renders "Без назви".
//   - `len` must be absent, not null, when unknown — the frontend does
//     `ep.len ?? saved.dur` and a null would shadow the measured fallback.
//
// Run: npm run data

import { writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asc } from 'drizzle-orm'
import { openReadOnly } from './lib/db.mjs'
import { cmpNewestFirst } from './lib/derive.mjs'
import { eras, vEpisodes, vSearch, vShowIndex } from '../db/schema.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')

// Optional keys are `undefined` rather than null so JSON.stringify drops them.
const drop = (v) => v || undefined

function build() {
  const { db, sqlite } = openReadOnly()

  const showRows = db.select().from(vShowIndex).orderBy(asc(vShowIndex.ord)).all()

  // One query for all 4930 episodes, grouped in memory — 148 round trips buys
  // nothing here.
  const byShow = new Map(showRows.map((s) => [s.id, []]))
  for (const e of db
    .select()
    .from(vEpisodes)
    .orderBy(asc(vEpisodes.showId), asc(vEpisodes.ord))
    .all()) {
    byShow.get(e.showId)?.push(e)
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'shows'), { recursive: true })

  let grandSeconds = 0
  let episodeCount = 0

  for (const show of showRows) {
    const episodes = byShow.get(show.id).map(toEpisode)

    // Newest first: date, then season/episode, then archive order — which the
    // `ord` sort above supplies, since Array.sort is stable.
    episodes.sort(cmpNewestFirst)

    writeFileSync(
      join(OUT, 'shows', `${show.slug}.json`),
      JSON.stringify({
        slug: show.slug,
        name: show.name,
        host: drop(show.host),
        img: drop(show.image),
        desc: drop(show.description),
        secs: drop(show.secs),
        episodes,
      }),
    )

    grandSeconds += show.secs
    episodeCount += episodes.length
  }

  const index = showRows.map((s) => ({
    slug: s.slug,
    name: s.name,
    host: drop(s.host),
    img: drop(s.image),
    desc: drop(s.description),
    n: s.n,
    secs: drop(s.secs),
    // Explicitly null, unlike the keys above: the frontend tests truthiness.
    y0: s.y0,
    y1: s.y1,
    era: s.era,
  }))
  // SQLite has no Ukrainian collation, so this one sort stays in JS.
  index.sort((a, b) => a.name.localeCompare(b.name, 'uk'))

  writeFileSync(
    join(OUT, 'index.json'),
    JSON.stringify({
      shows: index,
      eras: db
        .select({ id: eras.id, label: eras.label })
        .from(eras)
        .orderBy(asc(eras.ord))
        .all(),
      totals: {
        shows: index.length,
        episodes: episodeCount,
        seconds: grandSeconds,
      },
    }),
  )

  writeFileSync(join(OUT, 'search.json'), JSON.stringify(searchRows(db)))

  sqlite.close()
  report(index, episodeCount, grandSeconds)
}

// Key order matches what the old build emitted, so the output stays diffable
// against it.
function toEpisode(e) {
  const ep = { id: e.id, t: e.title, p: e.path }
  if (e.duration) ep.len = e.duration
  // The archive repeats the show name, the date and "сезон N эпизод M" in most
  // filenames; `r` keeps the original whenever cleanup changed it.
  if (e.title !== e.rawTitle) ep.r = e.rawTitle
  if (e.date) ep.d = e.date
  else if (e.year) ep.y = e.year
  if (e.season != null) ep.s = e.season
  if (e.episode != null) ep.e = e.episode
  if (e.host) ep.a = e.host
  if (e.description) ep.desc = e.description
  return ep
}

// Positional rows: [slug, id, title, host, date], trailing blanks dropped.
// The host rides along so "Коган" finds his episodes even though his name is
// no longer in their titles; the date is not searched, it just tells apart the
// many episodes that share a title ("Музыкальный баттл" runs weekly for years).
function searchRows(db) {
  return db
    .select({
      slug: vSearch.slug,
      id: vSearch.id,
      title: vSearch.title,
      host: vSearch.host,
      date: vSearch.date,
    })
    .from(vSearch)
    .orderBy(asc(vSearch.showOrd), asc(vSearch.ord))
    .all()
    .map(({ slug, id, title, host, date }) => {
      const row = [slug, id, title, host, date]
      while (row.length > 3 && !row[row.length - 1]) row.pop()
      return row
    })
}

function dirSize(dir) {
  return readdirSync(dir).reduce((sum, f) => {
    const p = join(dir, f)
    const s = statSync(p)
    return sum + (s.isDirectory() ? dirSize(p) : s.size)
  }, 0)
}

function report(index, episodeCount, grandSeconds) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`
  const byEra = {}
  for (const s of index) byEra[s.era] = (byEra[s.era] ?? 0) + 1

  console.log(`shows              ${index.length}`)
  console.log(`episodes           ${episodeCount}`)
  console.log(`eras               ${JSON.stringify(byEra)}`)
  console.log(`total runtime      ${Math.floor(grandSeconds / 3600)} h`)
  console.log(`index.json         ${kb(statSync(join(OUT, 'index.json')).size)}`)
  console.log(`search.json        ${kb(statSync(join(OUT, 'search.json')).size)}`)
  console.log(`shows/             ${kb(dirSize(join(OUT, 'shows')))}`)
}

build()
