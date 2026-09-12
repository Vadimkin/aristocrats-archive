// Everything that reads meaning out of an archive filename: dates, season and
// episode numbers, the host phrase, the display title, the show slug.
//
// Moved here verbatim from build-data.mjs when the archive became a SQLite
// database. It now runs exactly once, in import-tracks.mjs, instead of on
// every build. Treat it as frozen: it is tuned against 4930 real filenames
// and an innocent-looking regex tweak moves titles in bulk. `cmpNewestFirst`
// is the exception to "importer only" — the exporter needs it to order
// episodes within a show.
// ---------------------------------------------------------------- glyphs

// yt-dlp swaps filesystem-hostile characters for lookalikes. Put them back.
const GLYPHS = {
  '⧸': '/', // ⧸ big solidus
  '＂': '"', // ＂
  '｜': '|', // ｜
  '？': '?', // ？
  '：': ':', // ：
  '＊': '*', // ＊
  '＜': '<', // ＜
  '＞': '>', // ＞
  '＼': '\\', // ＼
}
const GLYPH_RE = new RegExp(`[${Object.keys(GLYPHS).join('')}]`, 'g')

export const restore = (s) => s.replace(GLYPH_RE, (c) => GLYPHS[c])

// ---------------------------------------------------------------- dates

const MONTHS = {
  // Ukrainian (genitive, as used in titles)
  січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6,
  липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12,
  // Russian
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
}

const MIN_YEAR = 2005

// Was `new Date().getFullYear() + 1`, which made the same filename parse
// differently in a different year. The importer passes the value it used and
// records it in the `meta` table, so a re-import can reproduce this one.
export const defaultMaxYear = () => new Date().getFullYear() + 1

const pad = (n) => String(n).padStart(2, '0')

function sane(y, m, d, maxYear) {
  if (y < MIN_YEAR || y > maxYear) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

// Returns { date: 'YYYY-MM-DD'|null, year: number|null, match: string|null }.
// `match` is the exact substring consumed, so the title cleaner can remove it.
export function extractDate(s, maxYear = defaultMaxYear()) {
  let m

  // 04.04.2016 / 1-10-2015 / 24/06/2021 (slash already restored from ⧸)
  m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/]((?:19|20)\d{2})/)
  if (m) {
    const iso = sane(+m[3], +m[2], +m[1], maxYear)
    if (iso) return { date: iso, year: +m[3], match: m[0] }
  }

  // 08 марта 2014 / 19 березня 2019
  m = s.match(/(\d{1,2})\s+([а-яіїєґА-ЯІЇЄҐ]+)\s+((?:19|20)\d{2})/)
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()]
    if (mon) {
      const iso = sane(+m[3], mon, +m[1], maxYear)
      if (iso) return { date: iso, year: +m[3], match: m[0] }
    }
  }

  // Bare year, last resort — good enough for era grouping.
  m = s.match(/\b((?:19|20)\d{2})\b/)
  if (m) {
    const y = +m[1]
    if (y >= MIN_YEAR && y <= maxYear) return { date: null, year: y, match: null }
  }

  return { date: null, year: null, match: null }
}

// ---------------------------------------------------------------- season / episode

// Returns { season, episode, matches: string[] }
export function extractSeasonEpisode(s) {
  const matches = []
  let season = null
  let episode = null
  let m

  // сезон 1 эпизод 3 / сезон 2 епізод 10 / сезон 3 випуск 4
  m = s.match(/сезон\s*(\d{1,2})\s*[,\-—–]?\s*(?:эпизод|епізод|випуск|выпуск|серия|серія)\s*(\d{1,4})/i)
  if (m) {
    season = +m[1]
    episode = +m[2]
    matches.push(m[0])
  } else {
    // s11e51
    m = s.match(/\bs(\d{1,2})\s*e(\d{1,4})\b/i)
    if (m) {
      season = +m[1]
      episode = +m[2]
      matches.push(m[0])
    } else {
      // Lone "сезон 4" or "Ep1" / "эпизод 12"
      const sm = s.match(/сезон\s*(\d{1,2})\b/i)
      if (sm) {
        season = +sm[1]
        matches.push(sm[0])
      }
      const em = s.match(/\b(?:Ep|эпизод|епізод|випуск|выпуск)\.?\s*(\d{1,4})\b/i)
      if (em) {
        episode = +em[1]
        matches.push(em[0])
      }
    }
  }

  return { season, episode, matches }
}

// ---------------------------------------------------------------- title cleanup

const SEPARATORS = '[\\s\\-—–:·|.,]'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Cyrillic/Latin lookalikes are mixed freely in these filenames — the show
// "5x300" has episodes titled "5х300". A 1:1 (length-preserving) map lets the
// prefix check see through that without breaking index arithmetic.
const HOMOGLYPHS = {
  а: 'a', в: 'b', е: 'e', і: 'i', ї: 'i', к: 'k', м: 'm', н: 'h',
  о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ѕ: 's', ј: 'j',
}
const fold = (s) =>
  s.toLowerCase().split('').map((c) => HOMOGLYPHS[c] ?? c).join('')

const SEP_ONLY = new RegExp(`^${SEPARATORS}+`)

// Drops the show name from the front of an episode title: the archive repeats it
// on most files ("Kitchen Confidential - сезон 1 эпизод 1").
export function stripShowPrefix(title, showName) {
  const clean = showName.replace(/^_/, '').trim()
  if (!clean) return title

  // Full name first, then the space-free spelling so "Ранкове Шоу" also
  // strips from "РанковеШоу".
  const candidates = [clean, clean.replace(/\s+/g, '')]
  const folded = fold(title)

  for (const c of candidates) {
    if (!c) continue
    if (!folded.startsWith(fold(c))) continue
    const rest = title.slice(c.length).replace(SEP_ONLY, '')
    if (rest.trim().length > 0) return rest
  }
  return title
}

export function tidy(s) {
  return s
    .replace(/\s+/g, ' ')
    // Pulling a date or "сезон N эпизод M" out of the middle leaves the
    // separators that framed it stranded: "Название - - Гость".
    .replace(/([\-—–:·|])(?:\s*[\-—–:·|])+/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/^[\s\-—–:·|,.]+/, '')
    .replace(/[\s\-—–:·|,]+$/, '')
    .trim()
}

// ---------------------------------------------------------------- host appendix

// Most shows repeat their host in the filename right after the show name:
//   "Второе свидание с Ярославом Лодыгиным — Big Move"
// Once the show prefix is stripped the host phrase reads like an episode title.
// It is not one — it is the tail of the show's own name, so it moves into `a`
// and the real title is whatever follows the delimiter.
const HOST_CONNECTOR = /^(?:з|зі|із|с|со|with|from)\s+(\S.*)$/i

// Delimiters the archive actually uses between host and episode title. A bare
// hyphen only counts when spaced — "Non-stop" must stay in one piece.
const HOST_SPLIT = /\s+[—–|·]\s*|\s+-\s+|\s*:\s+/

// Words that glue a list of hosts together: "з Лодигіним, Хомутовським і Чачибая".
const JOINERS = new Set(['і', 'и', 'й', 'та', 'and', '&'])

const capitalized = (w) => w[0] !== w[0].toLowerCase()

// The leading "connector + Name(s)" phrase of a title, or null when the title
// does not open with one. Shape only — recurrence is judged per show below.
function hostPhrase(title) {
  const head = title.split(HOST_SPLIT)[0].trim()
  const m = HOST_CONNECTOR.exec(head)
  if (!m) return null

  // Names only. "с Марьяной Головко_s9e1" is a filename the season/episode
  // parser could not read — leave it whole rather than half-parse it.
  if (/[\d_]/.test(m[1])) return null

  const words = m[1].split(/[\s,]+/).filter(Boolean)
  if (!words.length || words.length > 4) return null

  const names = words.filter((w) => !JOINERS.has(w.toLowerCase()))
  if (!names.length) return null
  // "Із неба та вітру" is a title; "з Олексієм Коганом" is a person.
  if (!names.every(capitalized)) return null

  return head
}

// Pulls the host phrase off every episode of one show. A phrase the archive
// repeats is a host; a one-off ("From This Place") is just a title that happens
// to start with a preposition. Returns a count per accepted phrase.
export function attachHosts(episodes) {
  const counts = new Map()
  for (const ep of episodes) {
    const head = ep.t ? hostPhrase(ep.t) : null
    if (head) counts.set(head, (counts.get(head) ?? 0) + 1)
  }

  const accepted = new Set([...counts].filter(([, n]) => n >= 2).map(([h]) => h))
  // Typos and case slips ("з Олексіє Коганом") show up once. Take them along
  // when they share a long head with a phrase that does recur.
  const recurring = [...accepted]
  for (const [head] of counts) {
    if (accepted.has(head) || head.length < 10) continue
    if (recurring.some((h) => h.slice(0, 9) === head.slice(0, 9))) accepted.add(head)
  }

  const hosts = new Map()
  for (const ep of episodes) {
    const head = ep.t ? hostPhrase(ep.t) : null
    if (!head || !accepted.has(head)) continue
    if (ep.r == null) ep.r = ep.t
    ep.a = head
    ep.t = tidy(ep.t.slice(head.length))
    hosts.set(head, (hosts.get(head) ?? 0) + 1)
  }
  return hosts
}

// The show's own host, when one phrase speaks for most of the archive: the
// name on the tin ("Bookself Шоу з Катериною Бабкіною"), not a guest of one
// season. Reported per show so the header can print the full name.
export function dominantHost(hosts, total) {
  let best = null
  for (const [head, n] of hosts) if (!best || n > best[1]) best = [head, n]
  if (!best) return null
  return best[1] >= 2 && best[1] / total >= 0.4 ? best[0] : null
}

// ---------------------------------------------------------------- slugs

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ie',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'iu', я: 'ia',
}

export function slugify(name) {
  const base = name
    .toLowerCase()
    .split('')
    .map((c) => (c in TRANSLIT ? TRANSLIT[c] : c))
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'show'
}

// ---------------------------------------------------------------- ordering

// Sort key: dated episodes newest-first, then season/episode descending,
// then whatever order the archive had.
export function cmpNewestFirst(a, b) {
  const ad = a.d ?? (a.y ? `${a.y}-00-00` : null)
  const bd = b.d ?? (b.y ? `${b.y}-00-00` : null)
  if (ad && bd && ad !== bd) return ad < bd ? 1 : -1
  if (ad && !bd) return -1
  if (!ad && bd) return 1
  if ((a.s ?? -1) !== (b.s ?? -1)) return (b.s ?? -1) - (a.s ?? -1)
  if ((a.e ?? -1) !== (b.e ?? -1)) return (b.e ?? -1) - (a.e ?? -1)
  return 0
}
