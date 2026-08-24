import { useEffect, useState } from 'preact/hooks'
import { Link } from 'wouter-preact'
import { loadShow } from '../lib/data.js'
import { store } from '../state/storage.js'
import { countDone, isFav, toggleFav, setManyDone, clearShow } from '../state/listening.js'
import { toItem, play } from '../state/player.js'
import { Header } from '../components/Header.jsx'
import { EpisodeRow } from '../components/EpisodeRow.jsx'
import { episodeWord, yearSpan, runtime } from '../lib/format.js'

export function Show({ slug }) {
  const [show, setShow] = useState(null)
  const [failed, setFailed] = useState(false)
  const [unplayedOnly, setUnplayedOnly] = useState(false)

  useEffect(() => {
    setShow(null)
    setFailed(false)
    scrollTo(0, 0)
    loadShow(slug).then(setShow, () => setFailed(true))
  }, [slug])

  if (failed || !show) {
    return (
      <div class="page">
        <Header />
        <div class="wrap">
          <BackRow />
          {failed ? <p class="empty">Шоу не знайдено.</p> : <p class="loading">Завантаження…</p>}
        </div>
      </div>
    )
  }

  const saved = store.value.episodes
  const visible = unplayedOnly ? show.episodes.filter((e) => !saved[e.id]?.done) : show.episodes

  const total = show.episodes.length
  const done = countDone(show.episodes)
  const years = yearsOf(show.episodes)
  const fav = isFav(slug)

  return (
    <div class="page">
      <Header />
      <div class="wrap">
        <BackRow />

        <div class="show-head">
          <h1>
            {show.name}
            {show.host && <span class="host"> {show.host}</span>}
          </h1>
          <div class="sub">
            {total} {episodeWord(total)}
            {years && ` · ${years}`}
            {show.secs ? ` · ${runtime(show.secs)}` : ''}
            {` · ${done} з ${total} прослухано`}
          </div>
          <div class="progress" aria-hidden="true">
            <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
        </div>

        <div class="actions">
          <button class={fav ? 'on' : ''} onClick={() => toggleFav(slug)}>
            {fav ? '★ В обраному' : '☆ В обране'}
          </button>
          <button onClick={() => setManyDone(show.episodes, true, show)} disabled={done === total}>
            Позначити все прослуханим
          </button>
          <button class="danger" onClick={() => clearShow(show.episodes)} disabled={!done}>
            Скинути
          </button>
        </div>

        <div class="filters">
          <button
            aria-pressed={unplayedOnly}
            class={unplayedOnly ? 'on' : ''}
            onClick={() => setUnplayedOnly(!unplayedOnly)}
          >
            Лише непрослухані
          </button>
        </div>

        {visible.length === 0 ? (
          <p class="empty">Усе прослухано.</p>
        ) : (
          visible.map((ep) => (
            <EpisodeRow key={ep.id} ep={ep} show={show} onPlay={() => play(toItem(ep, show))} />
          ))
        )}
      </div>
    </div>
  )
}

function BackRow() {
  return (
    <div class="backrow">
      <Link href="/">← Усі шоу</Link>
    </div>
  )
}

function yearsOf(episodes) {
  const years = episodes.map((e) => (e.d ? +e.d.slice(0, 4) : e.y)).filter(Boolean)
  if (!years.length) return ''
  return yearSpan(Math.min(...years), Math.max(...years))
}
