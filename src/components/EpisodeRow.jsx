import { store } from '../state/storage.js'
import { toggleDone, metaFor } from '../state/listening.js'
import { current as playingItem, playing } from '../state/player.js'
import { duration as fmtDuration, shortDate, seasonEpisode } from '../lib/format.js'

/**
 * One dense episode line: season/episode · title · date · length · played mark.
 * The row plays; the mark is a separate tap target so you can flag an episode
 * played without listening to it.
 */
export function EpisodeRow({ ep, show, onPlay }) {
  const saved = store.value.episodes[ep.id]
  const done = Boolean(saved?.done)
  const isCurrent = playingItem.value?.id === ep.id

  // ep.len comes from the build; saved.dur is what playback measured.
  const length = ep.len || saved?.dur ? fmtDuration(ep.len ?? saved.dur) : ''
  const total = ep.len ?? saved?.dur ?? 0
  const partial = !done && saved?.pos > 0 && total ? saved.pos / total : 0
  const se = seasonEpisode(ep)
  const date = shortDate(ep.d)
  // Only reserve the left gutter for episodes that actually carry a number —
  // an unnumbered track in a numbered show should start at the margin.
  const numbered = se !== ''

  const activate = (e) => {
    e.preventDefault()
    onPlay()
  }

  return (
    <div
      class={`ep${numbered ? '' : ' no-se'}${done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activate(e)}
      aria-label={`${ep.t || se || 'Епізод'}${done ? ', прослухано' : ''}`}
    >
      {numbered && <span class="se">{isCurrent && playing.value ? '▶' : se}</span>}

      <span class="body">
        <span class="title">{ep.t || <span class="dim">Без назви</span>}</span>
        {(date || (isCurrent && !se)) && (
          <span class="sub">
            {date && <span>{date}</span>}
          </span>
        )}
      </span>

      <span class="len">{length}</span>

      <button
        class={`mark${done ? ' on' : ''}`}
        title={done ? 'Позначити непрослуханим' : 'Позначити прослуханим'}
        aria-pressed={done}
        onClick={(e) => {
          e.stopPropagation()
          toggleDone(ep.id, metaFor(ep, show))
        }}
      >
        {done ? '✓' : '○'}
      </button>

      {partial > 0 && (
        <span class="hair" aria-hidden="true">
          <i style={{ width: `${Math.round(partial * 100)}%` }} />
        </span>
      )}
    </div>
  )
}
