import { signal } from '@preact/signals'
import { STORAGE_KEY, STORAGE_VERSION } from '../config.js'

// Shape:
// {
//   version, updatedAt,
//   episodes: { [id]: { pos, dur, done, doneAt, playedAt, m: {t, s, n, p} } },
//   shows:    { [slug]: { fav, lastPlayedId } },
//   player:   { current, queue, index, rate, volume },
// }
const empty = () => ({
  version: STORAGE_VERSION,
  updatedAt: 0,
  episodes: {},
  shows: {},
  player: {},
})

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw)
    if (parsed?.version !== STORAGE_VERSION) return empty()
    return { ...empty(), ...parsed }
  } catch {
    // Corrupt or unavailable (private mode) — start clean rather than crash.
    return empty()
  }
}

/** The whole database. Bumped only on changes the UI must react to. */
export const store = signal(read())

let saveTimer = null

function write() {
  saveTimer = null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.peek()))
  } catch (err) {
    console.warn('Не вдалося зберегти стан прослуховування', err)
  }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(write, 2000)
}

export function flush() {
  if (saveTimer) clearTimeout(saveTimer)
  write()
}

if (typeof window !== 'undefined') {
  // pagehide fires on iOS backgrounding where unload does not.
  addEventListener('pagehide', flush)
  addEventListener('visibilitychange', () => document.hidden && flush())
}

/** Mutate and notify subscribers. */
export function mutate(fn) {
  const db = store.peek()
  fn(db)
  db.updatedAt = Date.now()
  store.value = { ...db }
  scheduleSave()
}

/**
 * Mutate and persist WITHOUT re-rendering. For the every-few-seconds playback
 * position write, which no visible row depends on until playback stops.
 */
export function mutateQuietly(fn) {
  const db = store.peek()
  fn(db)
  db.updatedAt = Date.now()
  scheduleSave()
}

export const episodeEntry = (db, id) => (db.episodes[id] ??= {})
export const showEntry = (db, slug) => (db.shows[slug] ??= {})

// ------------------------------------------------------------------ export

export function exportBlob() {
  flush()
  return new Blob([JSON.stringify(store.peek(), null, 2)], { type: 'application/json' })
}

export function exportFilename() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `aristocrats-listening-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

// ------------------------------------------------------------------ import

function validate(data) {
  if (!data || typeof data !== 'object') throw new Error('Файл не є коректним JSON-обʼєктом')
  if (data.version !== STORAGE_VERSION) {
    throw new Error(`Непідтримана версія файлу: ${data.version ?? '—'} (очікується ${STORAGE_VERSION})`)
  }
  if (typeof data.episodes !== 'object' || data.episodes === null) {
    throw new Error('У файлі відсутній розділ episodes')
  }
  return { ...empty(), ...data }
}

/**
 * Union merge: an episode is done if either side says so, and the newer
 * playedAt wins for position. Never un-marks something already finished.
 */
export function importMerge(data) {
  const incoming = validate(data)
  const db = store.peek()
  let added = 0
  let updated = 0

  for (const [id, their] of Object.entries(incoming.episodes)) {
    const ours = db.episodes[id]
    if (!ours) {
      db.episodes[id] = their
      added++
      continue
    }
    const theirNewer = (their.playedAt ?? 0) > (ours.playedAt ?? 0)
    const merged = {
      ...ours,
      ...(theirNewer ? their : {}),
      done: Boolean(ours.done || their.done),
      dur: ours.dur ?? their.dur,
      m: ours.m ?? their.m,
      playedAt: Math.max(ours.playedAt ?? 0, their.playedAt ?? 0) || undefined,
      doneAt: Math.max(ours.doneAt ?? 0, their.doneAt ?? 0) || undefined,
    }
    if (merged.done) delete merged.pos
    db.episodes[id] = merged
    updated++
  }

  for (const [slug, their] of Object.entries(incoming.shows ?? {})) {
    const ours = db.shows[slug] ?? {}
    db.shows[slug] = { ...ours, ...their, fav: Boolean(ours.fav || their.fav) }
  }

  mutate(() => {})
  flush()
  return { added, updated }
}

export function resetAll() {
  store.value = empty()
  flush()
}
