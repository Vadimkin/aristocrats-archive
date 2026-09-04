// Turns tracks.json (3.5 MB) into small chunks the site can load lazily:
//   public/data/index.json          — 148 shows, era-grouped
//   public/data/shows/<slug>.json   — episodes of one show
//   public/data/search.json         — flat haystack for global episode search
//
// Run: node scripts/build-data.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashId } from './lib/hash.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')

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

const restore = (s) => s.replace(GLYPH_RE, (c) => GLYPHS[c])

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
const MAX_YEAR = new Date().getFullYear() + 1

const pad = (n) => String(n).padStart(2, '0')

function sane(y, m, d) {
  if (y < MIN_YEAR || y > MAX_YEAR) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

// Returns { date: 'YYYY-MM-DD'|null, year: number|null, match: string|null }.
// `match` is the exact substring consumed, so the title cleaner can remove it.
function extractDate(s) {
  let m

  // 04.04.2016 / 1-10-2015 / 24/06/2021 (slash already restored from ⧸)
  m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/]((?:19|20)\d{2})/)
  if (m) {
    const iso = sane(+m[3], +m[2], +m[1])
    if (iso) return { date: iso, year: +m[3], match: m[0] }
  }

  // 08 марта 2014 / 19 березня 2019
  m = s.match(/(\d{1,2})\s+([а-яіїєґА-ЯІЇЄҐ]+)\s+((?:19|20)\d{2})/)
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()]
    if (mon) {
      const iso = sane(+m[3], mon, +m[1])
      if (iso) return { date: iso, year: +m[3], match: m[0] }
    }
  }

  // Bare year, last resort — good enough for era grouping.
  m = s.match(/\b((?:19|20)\d{2})\b/)
  if (m) {
    const y = +m[1]
    if (y >= MIN_YEAR && y <= MAX_YEAR) return { date: null, year: y, match: null }
  }

  return { date: null, year: null, match: null }
}

// ---------------------------------------------------------------- season / episode

// Returns { season, episode, matches: string[] }
function extractSeasonEpisode(s) {
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
function stripShowPrefix(title, showName) {
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

function tidy(s) {
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
function attachHosts(episodes) {
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
function dominantHost(hosts, total) {
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

function slugify(name) {
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

// ---------------------------------------------------------------- eras

const ERAS = [
  { id: '2020s', label: '2020–2022', from: 2020, to: 9999 },
  { id: '2018', label: '2018–2019', from: 2018, to: 2019 },
  { id: '2016', label: '2016–2017', from: 2016, to: 2017 },
  { id: '2014', label: '2014–2015', from: 0, to: 2015 },
]
const ERA_UNKNOWN = { id: 'unknown', label: 'Без дати' }

const eraFor = (lastYear) =>
  lastYear == null
    ? ERA_UNKNOWN.id
    : (ERAS.find((e) => lastYear >= e.from && lastYear <= e.to) ?? ERAS.at(-1)).id

// ---------------------------------------------------------------- build

function build() {
  const src = JSON.parse(readFileSync(join(ROOT, 'tracks.json'), 'utf8'))

  // Produced by scan-durations.mjs from the local archive and committed, so a
  // plain build never needs the disk. Missing file just means no lengths.
  const durationsPath = join(ROOT, 'durations.json')
  const durations = existsSync(durationsPath)
    ? JSON.parse(readFileSync(durationsPath, 'utf8'))
    : {}
  if (!Object.keys(durations).length) {
    console.warn('durations.json missing — episode lengths and totals will be absent')
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'shows'), { recursive: true })

  const seenSlugs = new Map()
  const seenIds = new Map()
  const index = []
  const search = []
  const stats = {
    episodes: 0, withDate: 0, withYear: 0, withSeasonEp: 0, prefixStripped: 0, withLen: 0,
    hostMoved: 0, showsWithHost: 0,
  }
  let grandSeconds = 0

  for (const show of src.shows) {
    // Leading "_" marks the catch-all bucket; keep the name but sort it last.
    const displayName = restore(show.name)

    let slug = slugify(displayName)
    if (seenSlugs.has(slug)) {
      const n = seenSlugs.get(slug) + 1
      seenSlugs.set(slug, n)
      slug = `${slug}-${n}`
    }
    seenSlugs.set(slug, seenSlugs.get(slug) ?? 1)

    const episodes = []
    const years = []
    let showSeconds = 0

    for (const track of show.tracks) {
      const raw = restore(track.name).trim()

      const id = hashId(track.path)
      if (seenIds.has(id)) {
        throw new Error(
          `ID collision ${id}:\n  ${seenIds.get(id)}\n  ${track.path}\n` +
            'Widen hashId() — localStorage keys depend on these being unique.',
        )
      }
      seenIds.set(id, track.path)

      const { date, year, match: dateMatch } = extractDate(raw)
      const { season, episode, matches: seMatches } = extractSeasonEpisode(raw)

      let title = raw
      const before = title
      title = stripShowPrefix(title, displayName)
      if (title !== before) stats.prefixStripped++

      // Remove the bits now held in structured fields.
      for (const m of seMatches) title = title.split(m).join(' ')
      if (dateMatch) title = title.split(dateMatch).join(' ')
      title = tidy(title)

      // Cleanup can eat the whole title (e.g. "Название - сезон 1 эпизод 1 (05.04.2016)")
      // because the episode never had one. When the season/episode and date
      // columns already carry everything the filename said, leave the title
      // empty and let the row render its own placeholder — repeating
      // "сезон 1 эпизод 1 (05.04.2016)" next to "s1e1  05.04.16" is noise.
      // With no structured metadata to fall back on, keep the raw string.
      if (title.length < 2) {
        title = season != null || episode != null || date ? '' : raw
      }

      const len = durations[id]
      if (len) {
        showSeconds += len
        stats.withLen++
      }

      const ep = { id, t: title, p: track.path }
      if (len) ep.len = len
      if (title !== raw) ep.r = raw
      if (date) ep.d = date
      else if (year) ep.y = year
      if (season != null) ep.s = season
      if (episode != null) ep.e = episode

      episodes.push(ep)
      if (year) years.push(year)

      stats.episodes++
      if (date) stats.withDate++
      if (year) stats.withYear++
      if (season != null || episode != null) stats.withSeasonEp++
    }

    // Needs the whole show at once: a host phrase is only a host if it recurs.
    const hosts = attachHosts(episodes)
    const host = dominantHost(hosts, episodes.length)
    for (const n of hosts.values()) stats.hostMoved += n
    if (host) stats.showsWithHost++

    // The host belongs in the haystack too — "Коган" should find his episodes
    // even though his name is no longer in their titles. The date is not
    // searched; it rides along so results can tell apart the many episodes
    // that share a title ("Музыкальный баттл" runs weekly for years).
    // Positional rows: [slug, id, title, host, date], trailing blanks dropped.
    for (const ep of episodes) {
      if (!ep.t && !ep.a) continue
      const row = [slug, ep.id, ep.t, ep.a ?? '', ep.d ?? '']
      while (row.length > 3 && !row[row.length - 1]) row.pop()
      search.push(row)
    }

    // Newest first by default: date, then season/episode, then original order.
    episodes.sort(cmpNewestFirst)

    const firstYear = years.length ? Math.min(...years) : null
    const lastYear = years.length ? Math.max(...years) : null

    writeFileSync(
      join(OUT, 'shows', `${slug}.json`),
      JSON.stringify({ slug, name: displayName, host: host || undefined, secs: showSeconds || undefined, episodes }),
    )

    grandSeconds += showSeconds

    index.push({
      slug,
      name: displayName,
      host: host || undefined,
      n: episodes.length,
      secs: showSeconds || undefined,
      y0: firstYear,
      y1: lastYear,
      era: eraFor(lastYear),
    })
  }

  index.sort((a, b) => a.name.localeCompare(b.name, 'uk'))

  writeFileSync(
    join(OUT, 'index.json'),
    JSON.stringify({
      shows: index,
      eras: [...ERAS.map(({ id, label }) => ({ id, label })), ERA_UNKNOWN],
      totals: {
        shows: index.length,
        episodes: stats.episodes,
        seconds: grandSeconds,
      },
    }),
  )
  writeFileSync(join(OUT, 'search.json'), JSON.stringify(search))

  report(index, stats, grandSeconds)
}

// Sort key: dated episodes newest-first, then season/episode descending,
// then whatever order the archive had.
function cmpNewestFirst(a, b) {
  const ad = a.d ?? (a.y ? `${a.y}-00-00` : null)
  const bd = b.d ?? (b.y ? `${b.y}-00-00` : null)
  if (ad && bd && ad !== bd) return ad < bd ? 1 : -1
  if (ad && !bd) return -1
  if (!ad && bd) return 1
  if ((a.s ?? -1) !== (b.s ?? -1)) return (b.s ?? -1) - (a.s ?? -1)
  if ((a.e ?? -1) !== (b.e ?? -1)) return (b.e ?? -1) - (a.e ?? -1)
  return 0
}

function dirSize(dir) {
  return readdirSync(dir).reduce((sum, f) => {
    const p = join(dir, f)
    const s = statSync(p)
    return sum + (s.isDirectory() ? dirSize(p) : s.size)
  }, 0)
}

function report(index, stats, grandSeconds) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`
  const pct = (n) => `${((n / stats.episodes) * 100).toFixed(1)}%`
  const byEra = {}
  for (const s of index) byEra[s.era] = (byEra[s.era] ?? 0) + 1

  console.log(`shows              ${index.length}`)
  console.log(`episodes           ${stats.episodes}`)
  console.log(`  with full date   ${stats.withDate} (${pct(stats.withDate)})`)
  console.log(`  with a year      ${stats.withYear} (${pct(stats.withYear)})`)
  console.log(`  with season/ep   ${stats.withSeasonEp} (${pct(stats.withSeasonEp)})`)
  console.log(`  prefix stripped  ${stats.prefixStripped} (${pct(stats.prefixStripped)})`)
  console.log(`  with duration    ${stats.withLen} (${pct(stats.withLen)})`)
  console.log(`  host pulled out  ${stats.hostMoved} (${pct(stats.hostMoved)})`)
  console.log(`shows with a host  ${stats.showsWithHost}`)
  console.log(`eras               ${JSON.stringify(byEra)}`)
  console.log(`total runtime      ${Math.floor(grandSeconds / 3600)} h`)
  console.log(`index.json         ${kb(statSync(join(OUT, 'index.json')).size)}`)
  console.log(`search.json        ${kb(statSync(join(OUT, 'search.json')).size)}`)
  console.log(`shows/             ${kb(dirSize(join(OUT, 'shows')))}`)
}

build()
