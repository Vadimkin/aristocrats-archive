// Ukrainian plural: 1 епізод / 2-4 епізоди / 5+ епізодів
export function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const episodeWord = (n) => plural(n, 'епізод', 'епізоди', 'епізодів')
export const showWord = (n) => plural(n, 'шоу', 'шоу', 'шоу')

/** 4930 -> "4 930" (thin space, so it does not wrap or read as 4.930) */
export const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')

/**
 * Seconds -> "7 393 годин" for the archive total. After a count this large the
 * genitive plural is the wording we want, not the strict 2–4 form the general
 * `plural` helper would pick.
 */
export function hours(seconds) {
  const h = Math.round(seconds / 3600)
  return `${grouped(h)} ${h === 1 ? 'година' : 'годин'}`
}

/** Seconds -> "23 год 40 хв" for a single show. */
export function runtime(seconds) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (!h) return `${m} хв`
  return m ? `${grouped(h)} год ${m} хв` : `${grouped(h)} год`
}

export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// '2020-03-29' -> '29.03.20'
export function shortDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y.slice(2)}`
}

export function yearSpan(y0, y1) {
  if (!y0 && !y1) return ''
  if (!y0 || !y1 || y0 === y1) return String(y1 ?? y0)
  return `${y0}–${y1}`
}

// "s3e12", or just "s3" / "e12" when only one was parseable.
export function seasonEpisode(ep) {
  if (ep.s != null && ep.e != null) return `s${ep.s}e${ep.e}`
  if (ep.s != null) return `s${ep.s}`
  if (ep.e != null) return `e${ep.e}`
  return ''
}
