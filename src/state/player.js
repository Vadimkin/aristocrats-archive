import { signal } from '@preact/signals'
import { audioUrl, DONE_RATIO, DONE_TAIL_SECONDS, MIN_RESUME_SECONDS } from '../config.js'
import { store, mutate, mutateQuietly, episodeEntry, showEntry } from './storage.js'
import { resumePos } from './listening.js'
import { fullShowName } from '../lib/format.js'
import { track } from '../lib/track.js'
import { podcastImage } from '../lib/podcast-image.js'

export const current = signal(null) // { id, t, p, slug, showName, d, img }
export const playing = signal(false)
export const stalled = signal(false)
export const time = signal(0)
export const duration = signal(0)
export const buffered = signal(0)
export const volume = signal(1)
export const expanded = signal(false)
export const error = signal(null)

/** Normalise a show-JSON episode into a self-contained player item. */
export const toItem = (ep, show) => ({
  id: ep.id,
  t: ep.t,
  p: ep.p,
  d: ep.d,
  slug: show.slug,
  showName: fullShowName(show, ep),
  img: show.img,
})

/**
 * Attach the snapshot "Продовжити" and the restored player render from, or
 * top up one written before rows carried a date.
 */
function snapshot(e, item) {
  e.m ??= { t: item.t, s: item.slug, n: item.showName, p: item.p, d: item.d, i: item.img }
  if (item.d && !e.m.d) e.m.d = item.d
  if (item.img && !e.m.i) e.m.i = item.img
}

// ------------------------------------------------------------------ element

// Bare <audio>: no crossorigin attribute — the R2 bucket sends no CORS headers
// and a plain media load does not need them. Adding it would break playback.
const audio = typeof Audio !== 'undefined' ? new Audio() : null
audio?.setAttribute('preload', 'metadata')

let seekOnLoad = 0
let lastPersist = 0

function persistPosition(force = false) {
  const item = current.peek()
  if (!item) return
  const now = Date.now()
  if (!force && now - lastPersist < 5000) return
  lastPersist = now

  const pos = audio.currentTime
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0

  mutateQuietly((db) => {
    const e = episodeEntry(db, item.id)
    if (dur) e.dur = dur
    e.playedAt = now
    snapshot(e, item)
    // Below the threshold this is an accidental tap, not a resume point.
    if (!e.done && pos >= MIN_RESUME_SECONDS) e.pos = pos
    else if (!e.done) delete e.pos
  })
}

/** Persist and notify: rows show a resume hairline once you stop. */
function persistAndNotify() {
  persistPosition(true)
  mutate(() => {})
}

function markDone(item) {
  mutate((db) => {
    const e = episodeEntry(db, item.id)
    e.done = true
    e.doneAt = Date.now()
    e.playedAt = Date.now()
    snapshot(e, item)
    if (Number.isFinite(audio.duration)) e.dur = audio.duration
    delete e.pos
  })
}

const nearEnd = () => {
  const d = audio.duration
  if (!Number.isFinite(d) || d <= 0) return false
  return audio.currentTime >= d * DONE_RATIO || d - audio.currentTime <= DONE_TAIL_SECONDS
}

if (audio) {
  audio.addEventListener('loadedmetadata', () => {
    duration.value = Number.isFinite(audio.duration) ? audio.duration : 0
    if (seekOnLoad > 0 && seekOnLoad < audio.duration) {
      audio.currentTime = seekOnLoad
      time.value = seekOnLoad
    }
    seekOnLoad = 0
    updatePositionState()
    const item = current.peek()
    if (item && duration.value) {
      mutateQuietly((db) => {
        episodeEntry(db, item.id).dur = duration.value
      })
    }
  })

  audio.addEventListener('timeupdate', () => {
    time.value = audio.currentTime
    updatePositionState()
    const item = current.peek()
    if (item && !store.peek().episodes[item.id]?.done && nearEnd()) markDone(item)
    persistPosition()
  })

  audio.addEventListener('progress', () => {
    buffered.value = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0
  })

  audio.addEventListener('play', () => {
    playing.value = true
    error.value = null
    // Re-apply on every start, not just on play(): iOS discards the Now Playing
    // entry of a page it suspended in the background, and a resume from the
    // lock screen has to put it back or the next tap has nothing to talk to.
    updateMediaSession(current.peek())
    setPlaybackState('playing')
  })
  audio.addEventListener('pause', () => {
    playing.value = false
    // The pause event is queued, so it can land after unload() has already
    // cleared the entry — don't put a pointless paused one back.
    setPlaybackState(current.peek() ? 'paused' : 'none')
    persistAndNotify()
  })
  audio.addEventListener('waiting', () => (stalled.value = true))
  audio.addEventListener('playing', () => (stalled.value = false))
  audio.addEventListener('canplay', () => (stalled.value = false))

  audio.addEventListener('seeked', updatePositionState)

  // One episode at a time: mark it done and stop rather than rolling on.
  audio.addEventListener('ended', () => {
    const item = current.peek()
    if (item) markDone(item)
    playing.value = false
    setPlaybackState('paused')
  })

  audio.addEventListener('error', () => {
    // Tearing down the source in unload() fires this; there is nothing to report.
    if (!current.peek()) return
    stalled.value = false
    playing.value = false
    setPlaybackState('paused')
    const code = audio.error?.code
    error.value =
      code === 4
        ? 'Не вдалося відтворити цей файл — можливо, його немає у сховищі'
        : 'Помилка мережі. Спробуйте ще раз'
  })
}

// ------------------------------------------------------------------ actions

/**
 * @param item  the episode to play
 * @param opts  { restart } to ignore the saved resume position
 */
export function play(item, opts = {}) {
  const prev = current.peek()
  if (prev && prev.id !== item.id) persistAndNotify()

  current.value = item
  error.value = null
  time.value = 0
  duration.value = 0
  buffered.value = 0
  seekOnLoad = opts.restart ? 0 : resumePos(item.id)

  audio.src = audioUrl(item.p)
  audio.volume = volume.peek()
  audio.play().catch(() => {
    // Autoplay rejection or a bad source; the error handler reports real failures.
    playing.value = false
  })

  mutate((db) => {
    const e = episodeEntry(db, item.id)
    e.playedAt = Date.now()
    snapshot(e, item)
    showEntry(db, item.slug).lastPlayedId = item.id
  })

  // Only starting an episode counts. toggle() deliberately does not report, so
  // one listen is one event however often it gets paused and resumed. The
  // fallback matches the row's own placeholder for an episode with no title.
  track('Play Podcast', { podcast: item.t || 'Без назви', show: item.showName })

  updateMediaSession(item)
}

/**
 * Unload `id` if it is what is currently loaded. Dismissing the episode you
 * are listening to has to stop it — otherwise the 5s position write puts it
 * straight back into "Продовжити".
 */
export function unload(id) {
  if (current.peek()?.id !== id) return false
  // Clear `current` first: the pause/error handlers below key off it, so this
  // stops them from writing the position we are deliberately discarding.
  current.value = null
  playing.value = false
  time.value = 0
  duration.value = 0
  buffered.value = 0
  error.value = null
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  clearMediaSession()
  mutateQuietly((db) => {
    db.player = { ...db.player, current: null }
  })
  return true
}

export function toggle() {
  if (!current.peek()) return
  if (audio.paused) resume()
  else audio.pause()
}

/**
 * Start what is already loaded, reattaching the source first if the element
 * lost it. Locking an iOS device suspends the page, and Safari is free to tear
 * the media resource down while it is suspended; playing an element in that
 * state does nothing, which is what makes the lock-screen play button look
 * dead. Re-setting `src` is synchronous, so this still counts as handling the
 * gesture, and `seekOnLoad` puts the position back once metadata arrives.
 */
export function resume() {
  const item = current.peek()
  if (!item) return
  if (!audio.src || audio.networkState === HTMLMediaElement.NETWORK_EMPTY || audio.error) {
    seekOnLoad = audio.currentTime || time.peek() || resumePos(item.id)
    audio.src = audioUrl(item.p)
    audio.volume = volume.peek()
  }
  audio.play().catch(() => (playing.value = false))
}

export function seek(seconds) {
  if (!current.peek() || !Number.isFinite(audio.duration)) return
  audio.currentTime = Math.max(0, Math.min(audio.duration, seconds))
  time.value = audio.currentTime
}

export const skip = (delta) => seek(audio.currentTime + delta)

export function setVolume(value) {
  volume.value = value
  if (audio) audio.volume = value
  mutate((db) => (db.player = { ...db.player, volume: value }))
}

// ------------------------------------------------------------------ media session

// Built per call rather than once at module scope: the OS resolves these
// itself, with no document to resolve a relative path against, so they have to
// be absolute — and a sub-path deploy means they are not at the origin root.
const artwork = (filename) => {
  const image = podcastImage(filename)
  if (image) {
    const extension = filename.split('.').pop()?.toLowerCase()
    const type = extension === 'png'
      ? 'image/png'
      : extension === 'webp'
        ? 'image/webp'
        : 'image/jpeg'
    return [{ src: new URL(image, location.href).href, type }]
  }
  return [96, 192, 512].map((size) => ({
    src: new URL(`${import.meta.env.BASE_URL}cover-${size}.jpg`, location.href).href,
    sizes: `${size}x${size}`,
    type: 'image/jpeg',
  }))
}

const session = typeof navigator !== 'undefined' ? navigator.mediaSession : null

/** iOS throws NotSupportedError for actions it does not implement — and an
 *  unhandled throw here would take the rest of the transport down with it. */
function handler(action, fn) {
  try {
    session.setActionHandler(action, fn)
  } catch {
    // Not supported on this platform; the other actions still are.
  }
}

/**
 * The lock-screen transport. `play` and `pause` are deliberately separate
 * commands rather than one toggle: iOS sends the command for the button it
 * believes it is showing, so resolving it against `audio.paused` turns any
 * disagreement into the opposite action — tapping play would pause the episode
 * the system had just resumed, which reads as the button doing nothing.
 */
function setupActionHandlers() {
  if (!session) return
  handler('play', () => resume())
  handler('pause', () => audio.pause())
  handler('stop', () => audio.pause())
  handler('seekbackward', (d) => skip(-(d.seekOffset || 15)))
  handler('seekforward', (d) => skip(d.seekOffset || 30))
  handler('seekto', (d) => d.seekTime != null && seek(d.seekTime))
}

/** iOS decides which command to send from this, not from the element. */
function setPlaybackState(state) {
  if (session) session.playbackState = state
}

/** Keeps the lock screen's elapsed time honest, and the entry itself alive. */
function updatePositionState() {
  if (!session?.setPositionState) return
  const d = audio.duration
  if (!Number.isFinite(d) || d <= 0) return
  try {
    session.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(audio.currentTime, 0), d),
    })
  } catch {
    // A position outside the duration mid-seek; the next timeupdate is good.
  }
}

function updateMediaSession(item) {
  if (!session || !item) return
  session.metadata = new MediaMetadata({
    // Same placeholder the rows use: an episode whose title was pure
    // season/episode noise has none, and a blank lock screen looks broken.
    title: item.t || 'Без назви',
    artist: item.showName,
    album: 'Aristocrats FM',
    artwork: artwork(item.img),
  })
  updatePositionState()
}

function clearMediaSession() {
  if (!session) return
  session.metadata = null
  setPlaybackState('none')
}

// Registered once, not per episode: the lock screen outlives any single
// play(), and the handlers cost nothing while nothing is loaded.
if (audio) setupActionHandlers()

// ------------------------------------------------------------------ restore

/** Reload the last episode, paused at its saved position. Browsers block autoplay. */
export function restore() {
  const db = store.peek()
  const saved = db.player ?? {}
  if (saved.volume != null) {
    volume.value = saved.volume
    if (audio) audio.volume = saved.volume
  }

  if (!saved.current) return
  const item = saved.current
  current.value = item
  seekOnLoad = resumePos(item.id)
  time.value = seekOnLoad
  duration.value = db.episodes[item.id]?.dur ?? 0
  audio.src = audioUrl(item.p)
  updateMediaSession(item)
  setPlaybackState('paused')
}

/** Persist what the player is doing so a reload can pick it back up. */
export function persistPlayer() {
  mutateQuietly((db) => {
    db.player = { ...db.player, current: current.peek(), volume: volume.peek() }
  })
}

if (typeof window !== 'undefined') {
  addEventListener('pagehide', persistPlayer)
  addEventListener('visibilitychange', () => document.hidden && persistPlayer())
}
