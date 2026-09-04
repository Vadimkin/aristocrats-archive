import { useEffect, useState } from 'preact/hooks'
import { Link, useLocation } from 'wouter-preact'
import { loadIndex } from '../lib/data.js'
import { doneByShow, inProgress, favSlugs, forgetPosition } from '../state/listening.js'
import { play, unload } from '../state/player.js'
import { query } from '../state/search.js'
import { Header } from '../components/Header.jsx'
import { SearchResults } from '../components/Search.jsx'
import { yearSpan, episodeWord, showWord, grouped, hours, duration as fmtDuration } from '../lib/format.js'
import { useTitle } from '../lib/title.js'

export function Shows() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useTitle(null)

  useEffect(() => {
    loadIndex().then(setData, () => setFailed(true))
  }, [])

  const q = query.value.trim().toLowerCase()

  return (
    <div class="page">
      <Header />
      <div class="searchbar">
        <div class="searchbar-inner">
          <input
            class="search"
            type="search"
            value={query.value}
            placeholder="Пошук шоу та епізодів"
            aria-label="Пошук шоу та епізодів"
            onInput={(e) => (query.value = e.currentTarget.value)}
          />
        </div>
      </div>
      <div class="wrap">
        {failed && <p class="empty">Не вдалося завантажити список шоу.</p>}
        {!data && !failed && <p class="loading">Завантаження…</p>}

        {data && q && <SearchResults query={q} shows={data.shows} />}

        {data && !q && (
          <>
            <ContinueSection />
            <FavouritesSection shows={data.shows} />
            {data.eras.map((era) => {
              const list = data.shows.filter((s) => s.era === era.id)
              if (!list.length) return null
              return (
                <section key={era.id}>
                  <div class="section-head">
                    <h2>{era.label}</h2>
                    <span class="count">
                      {list.length} {showWord(list.length)}
                    </span>
                  </div>
                  <div class="show-list">
                    {list.map((s) => (
                      <ShowRow key={s.slug} show={s} />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}

        {data && (
          <div class="footer">
            {grouped(data.totals.shows)} {showWord(data.totals.shows)} ·{' '}
            {grouped(data.totals.episodes)} {episodeWord(data.totals.episodes)} ·{' '}
            {hours(data.totals.seconds)} ефіру
          </div>
        )}
      </div>
    </div>
  )
}

function ShowRow({ show }) {
  const done = doneByShow.value[show.slug] ?? 0
  const complete = done >= show.n

  return (
    <div class={`row show-row${complete ? ' is-done' : ''}`}>
      <span class="grow">
        <Link class="name" href={`/show/${show.slug}`}>
          {show.name}
          {show.host && <span class="host"> {show.host}</span>}
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

function ContinueSection() {
  const list = inProgress.value.slice(0, 8)
  const [, navigate] = useLocation()
  if (!list.length) return null

  return (
    <section>
      <div class="section-head">
        <h2>Продовжити</h2>
        <span class="count">{list.length}</span>
      </div>
      {list.map((item) => {
        const left = item.dur ? item.dur - item.pos : 0
        return (
          <div key={item.id} class="row">
            <button
              class="grow"
              style={{ textAlign: 'left' }}
              onClick={() =>
                play({
                  id: item.id,
                  t: item.t,
                  p: item.p,
                  d: item.d,
                  slug: item.slug,
                  showName: item.showName,
                })
              }
            >
              <span class="title" style={{ color: 'var(--link)' }}>{item.t}</span>
              <div class="dim" style={{ fontSize: '12.5px' }}>
                {item.showName}
                {left > 0 && ` · лишилось ${fmtDuration(left)}`}
              </div>
            </button>
            <button
              class="dismiss"
              title="Прибрати з «Продовжити»"
              aria-label={`Прибрати ${item.t} з «Продовжити»`}
              onClick={() => {
                unload(item.id)
                forgetPosition(item.id)
              }}
            >
              ×
            </button>
            <button
              class="meta"
              onClick={() => navigate(`/show/${item.slug}`)}
              aria-label={`Перейти до ${item.showName}`}
            >
              →
            </button>
          </div>
        )
      })}
    </section>
  )
}

function FavouritesSection({ shows }) {
  const slugs = new Set(favSlugs.value)
  if (!slugs.size) return null
  const list = shows.filter((s) => slugs.has(s.slug))
  if (!list.length) return null

  return (
    <section>
      <div class="section-head">
        <h2>Обране</h2>
        <span class="count">
          {list.length} {showWord(list.length)}
        </span>
      </div>
      <div class="show-list">
        {list.map((s) => (
          <ShowRow key={s.slug} show={s} />
        ))}
      </div>
    </section>
  )
}