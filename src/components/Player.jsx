import { useEffect, useRef } from 'preact/hooks'
import { Link } from 'wouter-preact'
import {
  current, playing, stalled, time, duration, buffered, expanded, error,
  toggle, seek,
} from '../state/player.js'
import { duration as fmtDuration } from '../lib/format.js'

export function Player() {
  const el = useRef(null)

  // Keep body padding in step with the player's real height so the last row
  // is never hidden behind it.
  useEffect(() => {
    if (!el.current) return
    const ro = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--player-h', `${entry.contentRect.height}px`)
    })
    ro.observe(el.current)
    return () => ro.disconnect()
  })

  if (!current.value) return null

  const item = current.value
  const dur = duration.value || 0
  const pct = dur ? (time.value / dur) * 100 : 0

  return (
    <div class="player" ref={el}>
      {!expanded.value && (
        <div class="line" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}

      <div class="bar">
        <button class="pp" onClick={toggle} aria-label={playing.value ? 'Пауза' : 'Грати'}>
          {stalled.value ? '⋯' : playing.value ? '❚❚' : '▶'}
        </button>

        <button
          class="info"
          onClick={() => (expanded.value = !expanded.value)}
          aria-expanded={expanded.value}
        >
          <div class="t">{item.t}</div>
          <div class="s">{item.showName}</div>
        </button>

        <button
          class="chev"
          onClick={() => (expanded.value = !expanded.value)}
          aria-label={expanded.value ? 'Згорнути' : 'Розгорнути'}
        >
          {expanded.value ? '⌄' : '⌃'}
        </button>
      </div>

      {error.value && <div class="err">{error.value}</div>}

      {expanded.value && <Sheet item={item} dur={dur} />}
    </div>
  )
}

function Sheet({ item, dur }) {
  const bufPct = dur ? (buffered.value / dur) * 100 : 0

  return (
    <div class="sheet">
      <div class="scrub">
        <input
          type="range"
          min="0"
          max={dur || 0}
          step="1"
          value={time.value}
          disabled={!dur}
          onInput={(e) => seek(Number(e.currentTarget.value))}
          aria-label="Позиція відтворення"
          style={{
            background: `linear-gradient(to right, var(--line) ${bufPct}%, transparent ${bufPct}%)`,
          }}
        />
        <div class="times">
          <span>{fmtDuration(time.value) || '0:00'}</span>
          <span>{dur ? `−${fmtDuration(dur - time.value)}` : '—'}</span>
        </div>
      </div>

      <div class="sheet-row">
        <Link href={`/show/${item.slug}`} onClick={() => (expanded.value = false)}>
          {item.showName} →
        </Link>
      </div>
    </div>
  )
}
