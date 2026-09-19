import { signal } from '@preact/signals'
import { fullShowName } from '../lib/format.js'

const SCRIPT = 'https://tally.so/widgets/embed.js'
const FORM = 'A7kAJz'

let loading = null

function ensureTally() {
  if (window.Tally) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => resolve(), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT
    s.onload = () => resolve()
    s.onerror = () => resolve()
    document.body.appendChild(s)
  })
  return loading
}

function hiddenFields(ep, show) {
  const fields = { track_id: ep.id, show: fullShowName(show, ep) }
  if (ep.d) fields.date = ep.d
  return fields
}

const suggestingId = signal(null)

/**
 * Tiny "запропонувати" next to an unnamed episode. Opens Tally as a modal
 * popup and passes the track id as a hidden field so the submission can be
 * matched; the widget also appends originPage from the current URL.
 */
export function SuggestName({ ep, show }) {
  const open = suggestingId.value === ep.id

  return (
    <button
      type="button"
      class={`suggest${open ? ' is-open' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openPopup(ep, show)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      запропонувати
    </button>
  )
}

async function openPopup(ep, show) {
  await ensureTally()
  if (!window.Tally) return
  // Same form id for every row: close first so a second click does not stack.
  window.Tally.closePopup(FORM)
  window.Tally.openPopup(FORM, {
    layout: 'modal',
    width: 375,
    hideTitle: true,
    hiddenFields: hiddenFields(ep, show),
    onOpen: () => {
      suggestingId.value = ep.id
    },
    onClose: () => {
      if (suggestingId.value === ep.id) suggestingId.value = null
    },
  })
}
