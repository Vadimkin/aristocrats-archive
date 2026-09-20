import { useEffect } from 'preact/hooks'
import { signal, effect } from '@preact/signals'
import { current, playing } from '../state/player.js'
import {
  SITE,
  SITE_DESCRIPTION,
  OG_IMAGE,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  imageType,
  syncDocumentMeta,
} from './page-meta.js'

// Kept in step with the static <title> in index.html by hand — that one is what
// shows in the tab until the bundle boots, so the two should read the same.
const HOME_TITLE = SITE

// What the route wants the tab to say, or null for the landing page. A signal
// rather than a direct document.title write because playback can override it at
// any moment, so the two inputs have to be resolved in one place.
const routeTitle = signal(null)
const routeDescription = signal(null)
const routeImage = signal(null)
// Social tags wait for a route to claim them so a prerendered `/show/<slug>`
// is not overwritten with the homepage card the moment the bundle boots.
const metaReady = signal(false)

/**
 * Claim the tab title (and the social tags) for the current route. Pass null
 * for the landing page, which wants the site title on its own rather than a
 * suffix.
 *
 * `description` / `image` fill og/twitter/canonical. Omit them for the
 * homepage defaults. `{ defer: true }` updates the tab title but leaves the
 * tags alone — used while a show JSON is in flight so a prerendered card is
 * not overwritten with the homepage one, and so navigating between shows does
 * not flash the previous show's title into the tags under a loading screen.
 *
 * Every route sets a title, so there is deliberately no cleanup: writing the
 * default back on unmount would only land between one route's teardown and the
 * next route's effect, where nobody can see it.
 */
export function useTitle(text, extras) {
  useEffect(() => {
    routeTitle.value = text
    if (extras?.defer) return
    routeDescription.value = extras?.description ?? null
    routeImage.value = extras?.image ?? null
    metaReady.value = true
  }, [text, extras?.defer, extras?.description, extras?.image])
}

function routePage() {
  const title = routeTitle.value || SITE
  const description = routeDescription.value || SITE_DESCRIPTION
  const url = location.origin + location.pathname
  const image = routeImage.value
  if (image) {
    const href = new URL(image, location.href).href
    return {
      title,
      description,
      url,
      image: href,
      imageType: imageType(href),
      imageAlt: title,
      card: 'summary',
    }
  }
  return {
    title,
    description,
    url,
    image: new URL(`${import.meta.env.BASE_URL}${OG_IMAGE}`, location.href).href,
    imageType: 'image/webp',
    imageWidth: OG_IMAGE_WIDTH,
    imageHeight: OG_IMAGE_HEIGHT,
    imageAlt: SITE,
    card: 'summary_large_image',
  }
}

// Playback outranks the route, on every page rather than only the show one: the
// 🎧 is there to pick this tab out of a crowded window, which is exactly when
// you have navigated away from the episode you are listening to. Pausing hands
// the title back to the route. Social tags stay with the route — a shared URL
// is the page, not whatever happens to be in the player.
effect(() => {
  const item = playing.value ? current.value : null
  document.title = item
    ? `🎧 ${item.t || 'Без назви'} | ${item.showName} | ${SITE}`
    : routeTitle.value
      ? `${routeTitle.value} | ${SITE}`
      : HOME_TITLE
})

effect(() => {
  if (!metaReady.value) return
  syncDocumentMeta(routePage())
})
