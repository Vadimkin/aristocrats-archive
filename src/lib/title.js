import { useEffect } from 'preact/hooks'
import { signal, effect } from '@preact/signals'
import { current, playing } from '../state/player.js'

// Kept in step with the static <title> in index.html by hand — that one is what
// shows in the tab until the bundle boots, so the two should read the same.
const SITE = 'Аристократи'
const HOME_TITLE = `${SITE} — архів подкастів`

// What the route wants the tab to say, or null for the landing page. A signal
// rather than a direct document.title write because playback can override it at
// any moment, so the two inputs have to be resolved in one place.
const routeTitle = signal(null)

/**
 * Claim the tab title for the current route. Pass null for the landing page,
 * which wants the site title on its own rather than a suffix.
 *
 * Every route sets a title, so there is deliberately no cleanup: writing the
 * default back on unmount would only land between one route's teardown and the
 * next route's effect, where nobody can see it.
 */
export function useTitle(text) {
  useEffect(() => {
    routeTitle.value = text
  }, [text])
}

// Playback outranks the route, on every page rather than only the show one: the
// 🎧 is there to pick this tab out of a crowded window, which is exactly when
// you have navigated away from the episode you are listening to. Pausing hands
// the title back to the route.
effect(() => {
  const item = playing.value ? current.value : null
  document.title = item
    ? `🎧 ${item.t || 'Без назви'} | ${item.showName} | ${SITE}`
    : routeTitle.value
      ? `${routeTitle.value} | ${SITE}`
      : HOME_TITLE
})
