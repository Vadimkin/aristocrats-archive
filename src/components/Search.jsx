import { useEffect, useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import { loadSearchIndex, loadShow } from '../lib/data.js'
import { store } from '../state/storage.js'
import { doneByShow } from '../state/listening.js'
import { play, toItem } from '../state/player.js'
import { Highlight } from '../lib/highlight.jsx'
import { yearSpan, episodeWord, showWord, fullShowName } from '../lib/format.js'

const LIMIT = 60

// Titles are stored in their display case; fold once per load rather than on
// every keystroke. The host phrase is folded in too — it left the title at
// build time, but "Коган" should still find his episodes.
const foldCache = new WeakMap()
function foldedFor(index) {
  let folded = foldCache.get(index)
  if (!folded) {
    folded = index.map(([, , title, host]) => (host ? `${title} ${host}` : title).toLowerCase())
    foldCache.set(index, folded)
  }
  return folded
}

/** One list covering both shows and episodes, matches highlighted. */
export function SearchResults({ query, shows }) {
  const [index, setIndex] = useState(null)
  const [failed, setFailed] = useState(false)

  // 400 KB, so it is fetched on the first search and cached from then on.
  useEffect(() => {
    loadSearchIndex().then(setIndex, () => setFailed(true))
  }, [])

  const showHits = shows.filter((s) =>
    (s.host ? `${s.name} ${s.host}` : s.name).toLowerCase().includes(query),
  )

  const episodeHits = []
  if (index) {
    const folded = foldedFor(index)
    for (let i = 0; i < index.length && episodeHits.length < LIMIT; i++) {
      if (folded[i].includes(query)) {
        const [slug, id, title, host] = index[i]
        episodeHits.push({ slug, id, title, host })
      }
    }
  }

  const bySlug = Object.fromEntries(shows.map((s) => [s.slug, s]))
  const nothing = !showHits.length && index && !episodeHits.length

  return (
    <>
      {showHits.length > 0 && (
        <section>
          <div class="section-head">
            <h2>Шоу</h2>
            <span class="count">
              {showHits.length} {showWord(showHits.length)}
            </span>
          </div>
          <div class="show-list">
            {showHits.map((s) => (
              <ShowHit key={s.slug} show={s} query={query} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div class="section-head">
          <h2>Епізоди</h2>
          <span class="count">
            {!index ? '…' : episodeHits.length >= LIMIT ? `${LIMIT}+` : episodeHits.length}
          </span>
        </div>
        {failed && <p class="empty">Не вдалося завантажити пошуковий індекс.</p>}
        {!index && !failed && <p class="loading">Пошук…</p>}
        {index && !episodeHits.length && <p class="empty">Епізодів не знайдено.</p>}
        {episodeHits.map((hit) => (
          <EpisodeHit key={hit.id} hit={hit} show={bySlug[hit.slug]} query={query} />
        ))}
      </section>

      {nothing && <p class="empty">Нічого не знайшлося.</p>}
    </>
  )
}

function ShowHit({ show, query }) {
  const done = doneByShow.value[show.slug] ?? 0
  const complete = done >= show.n

  return (
    <div class={`row show-row${complete ? ' is-done' : ''}`}>
      <span class="grow">
        <Link class="name" href={`/show/${show.slug}`}>
          <Highlight text={show.name} query={query} />
          {show.host && (
            <span class="host"> <Highlight text={show.host} query={query} /></span>
          )}
        </Link>
      </span>
      <span class="stats">
        {complete ? '✓ ' : done > 0 ? `${done}/` : ''}
        {show.n} {episodeWord(show.n)}
        {show.y1 ? ` · ${yearSpan(show.y0, show.y1)}` : ''}
      </span>
    </div>
  )
}

function EpisodeHit({ hit, show, query }) {
  const done = Boolean(store.value.episodes[hit.id]?.done)
  const showName = show ? fullShowName(show, { a: hit.host }) : ''

  // The search index carries no path, so pull the episode from its show JSON.
  const start = async () => {
    const full = await loadShow(hit.slug)
    const ep = full.episodes.find((e) => e.id === hit.id)
    if (ep) play(toItem(ep, full))
  }

  return (
    <div class={`row${done ? ' is-done' : ''}`}>
      <button class="grow" style={{ textAlign: 'left' }} onClick={start}>
        <span class="title" style={{ color: done ? 'var(--dim)' : 'var(--link)' }}>
          {hit.title ? <Highlight text={hit.title} query={query} /> : <span class="dim">Без назви</span>}
        </span>
        <div class="dim" style={{ fontSize: '12.5px' }}>
          <Highlight text={showName} query={query} />
        </div>
      </button>
      <Link class="meta" href={`/show/${hit.slug}`} aria-label={`Перейти до ${showName}`}>
        →
      </Link>
    </div>
  )
}
