import { computed } from '@preact/signals'
import { store, mutate, episodeEntry, showEntry } from './storage.js'
import { MIN_RESUME_SECONDS } from '../config.js'
import { fullShowName } from '../lib/format.js'

export const epState = (id) => store.value.episodes[id] ?? null

export const isDone = (id) => Boolean(store.value.episodes[id]?.done)

/** Seconds to resume from, or 0. Finished episodes always restart. */
export function resumePos(id) {
  const e = store.value.episodes[id]
  if (!e || e.done) return 0
  return e.pos && e.pos >= MIN_RESUME_SECONDS ? e.pos : 0
}

export const knownDuration = (id) => store.value.episodes[id]?.dur ?? 0

/** 0–1, or 0 when we have no duration yet. */
export function fraction(id) {
  const e = store.value.episodes[id]
  if (!e) return 0
  if (e.done) return 1
  if (!e.dur || !e.pos) return 0
  return Math.min(1, e.pos / e.dur)
}

export function setDone(id, done, meta) {
  mutate((db) => {
    const e = episodeEntry(db, id)
    e.done = done
    if (done) {
      e.doneAt = Date.now()
      delete e.pos
    } else {
      delete e.doneAt
      delete e.pos
    }
    if (meta && !e.m) e.m = meta
  })
}

export const toggleDone = (id, meta) => setDone(id, !isDone(id), meta)

/**
 * Drop the saved resume point so the episode leaves "Продовжити", while
 * leaving it unplayed. The cached duration and snapshot stay — they cost
 * nothing and spare a re-fetch if the episode is opened again.
 */
export function forgetPosition(id) {
  mutate((db) => {
    const e = db.episodes[id]
    if (!e) return
    delete e.pos
  })
}

export function setManyDone(episodes, done, show) {
  mutate((db) => {
    for (const ep of episodes) {
      const e = episodeEntry(db, ep.id)
      e.done = done
      if (done) {
        e.doneAt = Date.now()
        delete e.pos
        e.m ??= metaFor(ep, show)
      } else {
        delete e.doneAt
        delete e.pos
      }
    }
  })
}

/** Forget a show entirely: played marks and positions for all its episodes. */
export function clearShow(episodes) {
  mutate((db) => {
    for (const ep of episodes) delete db.episodes[ep.id]
  })
}

/** Minimal snapshot so "Продовжити" can render without loading show JSON. */
export const metaFor = (ep, show) => ({ t: ep.t, s: show.slug, n: fullShowName(show, ep), p: ep.p })

export function countDone(episodes) {
  const { episodes: saved } = store.value
  let n = 0
  for (const ep of episodes) if (saved[ep.id]?.done) n++
  return n
}

// ------------------------------------------------------------------ shows

export const isFav = (slug) => Boolean(store.value.shows[slug]?.fav)

export function toggleFav(slug) {
  mutate((db) => {
    const s = showEntry(db, slug)
    s.fav = !s.fav
  })
}

export const favSlugs = computed(() =>
  Object.entries(store.value.shows)
    .filter(([, s]) => s.fav)
    .map(([slug]) => slug),
)

// ------------------------------------------------------------------ continue

/** Started-but-unfinished episodes, most recently played first. */
export const inProgress = computed(() =>
  Object.entries(store.value.episodes)
    .filter(([, e]) => !e.done && e.pos >= MIN_RESUME_SECONDS && e.m)
    .sort((a, b) => (b[1].playedAt ?? 0) - (a[1].playedAt ?? 0))
    .map(([id, e]) => ({
      id,
      t: e.m.t,
      p: e.m.p,
      slug: e.m.s,
      showName: e.m.n,
      pos: e.pos,
      dur: e.dur ?? 0,
    })),
)

/**
 * { slug: doneCount } across every show, without loading any show JSON —
 * each touched episode carries its show slug in its snapshot.
 */
export const doneByShow = computed(() => {
  const out = {}
  for (const e of Object.values(store.value.episodes)) {
    if (e.done && e.m?.s) out[e.m.s] = (out[e.m.s] ?? 0) + 1
  }
  return out
})
