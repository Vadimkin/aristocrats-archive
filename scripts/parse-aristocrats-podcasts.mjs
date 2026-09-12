// Imports the metadata still available on aristocrats.fm:
//   podcast cards  -> show cover images
//   show pages     -> show blurbs, episode tracklists
//   working RSS    -> episode show notes
//
// The archive DB remains authoritative. Website shows and episodes are matched
// conservatively and unmatched records are reported, never inserted.
//
// Run: npm run db:parse-aristocrats-podcasts

import {
  existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { open } from './lib/db.mjs'
import { meta } from '../db/schema.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_URL = 'https://aristocrats.fm/podcasts/'
const IMAGE_DIR = join(ROOT, 'assets', 'podcasts')
const ALIASES_PATH = join(ROOT, 'scripts', 'data', 'site-aliases.json')
const REQUEST_DELAY_MS = 75
const USER_AGENT = 'aristocrats-player metadata importer'

const ENTITY = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

const MONTHS = new Map(
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    .map((month, index) => [month, index + 1]),
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function decodeHtml(value = '') {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] !== '#') return ENTITY[key.toLowerCase()] ?? entity
    const hex = key[1].toLowerCase() === 'x'
    const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity
  })
}

function htmlToText(html = '') {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function attribute(tag, name) {
  return decodeHtml(
    tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2] ?? '',
  )
}

function classContents(html, className, tagName = '[a-z][\\w:-]*') {
  const pattern = new RegExp(
    `<(${tagName})\\b[^>]*class\\s*=\\s*(["'])[^"']*\\b${className}\\b[^"']*\\2[^>]*>` +
      `([\\s\\S]*?)<\\/\\1\\s*>`,
    'i',
  )
  return html.match(pattern)?.[3] ?? ''
}

function parseCatalog(html) {
  const cards = []
  const anchors = html.match(
    /<a\b[^>]*class\s*=\s*(["'])[^"']*\bshow-wrapper\b[^"']*\1[^>]*>[\s\S]*?<\/a\s*>/gi,
  ) ?? []

  for (const anchor of anchors) {
    const open = anchor.match(/^<a\b[^>]*>/i)?.[0] ?? ''
    const href = attribute(open, 'href')
    const title = htmlToText(classContents(anchor, 'title', 'h[1-6]'))
    const imageTag = anchor.match(
      /<(?:div|span)\b[^>]*class\s*=\s*(["'])[^"']*\bimage\b[^"']*\1[^>]*>/i,
    )?.[0]
    const style = imageTag ? attribute(imageTag, 'style') : ''
    const imagePath = style.match(
      /background-image\s*:\s*url\(\s*(?:(["'])(.*?)\1|([^)'"]+))\s*\)/i,
    )
    const image = imagePath?.[2] ?? imagePath?.[3]?.trim() ?? ''
    if (!href || !title) continue

    const siteUrl = new URL(href, CATALOG_URL).href
    cards.push({
      siteSlug: basename(new URL(siteUrl).pathname),
      siteUrl,
      title,
      imageUrl: image ? new URL(image, CATALOG_URL).href : null,
    })
  }

  return cards
}

function parseShowPage(html, pageUrl) {
  const introStart = html.search(/\bshow-intro\b/i)
  const introEnd = introStart >= 0 ? html.indexOf('inner-content-wrapper', introStart) : -1
  const intro = introStart >= 0
    ? html.slice(introStart, introEnd >= 0 ? introEnd : introStart + 12_000)
    : ''
  const coverUrls = [...intro.matchAll(
    /background-image\s*:\s*url\(\s*(?:(["'])(.*?)\1|([^)'"]+))\s*\)/gi,
  )]
    .map((match) => match[2] ?? match[3]?.trim())
    .filter(Boolean)
    .map((value) => new URL(value, pageUrl).href)
    .filter((value) => new URL(value).pathname.includes('/media/uploads/'))

  const archive = html.match(
    /<div\b[^>]*\bid\s*=\s*(["'])archive\1[^>]*>([\s\S]*?)<div\b[^>]*class\s*=\s*(["'])[^"']*\bpodcasts-list\b[^"']*\3/i,
  )?.[2] ?? ''
  const beforeFeed = archive.split(/<a\b[^>]*>\s*RSS\s*<\/a>/i)[0]
  const paragraphs = [...beforeFeed.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)]
  const description = paragraphs.map((match) => htmlToText(match[1])).find(Boolean) ?? null

  const rssHref = html.match(
    /<a\b([^>]*)>\s*RSS\s*<\/a>/i,
  )
  const rssUrl = rssHref ? new URL(attribute(rssHref[0], 'href'), pageUrl).href : null

  const episodes = []
  const rows = html.match(
    /<a\b[^>]*class\s*=\s*(["'])[^"']*\bpodcast_line\b[^"']*\1[^>]*>[\s\S]*?<\/a\s*>/gi,
  ) ?? []
  for (const row of rows) {
    const date = siteDateToIso(htmlToText(classContents(row, 'date')))
    const title = htmlToText(classContents(row, 'ttl', 'span'))
    if (!date || !title) continue
    const content = htmlToText(classContents(row, 'podcast-content'))
    const tracklist = htmlToText(classContents(row, 'tracklist'))
    episodes.push({
      date,
      title,
      seasonEpisode: extractSeasonEpisode(title),
      description: content || tracklist || null,
    })
  }

  return { description, episodes, rssUrl, coverUrls: [...new Set(coverUrls)] }
}

function parseRss(xml) {
  const items = []
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const item = match[1]
    const title = xmlTagText(item, 'title')
    const description = xmlTagText(item, 'description')
    const date = rssDateToIso(xmlTagText(item, 'pubDate'))
    if (title && description && date) items.push({ title, description, date })
  }
  return items
}

function xmlTagText(xml, tag) {
  const escaped = tag.replace(':', '\\:')
  const value = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'))?.[1]
  if (!value) return ''
  return htmlToText(value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'))
}

function siteDateToIso(value) {
  const match = value.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

function rssDateToIso(value) {
  const match = value.match(/\b(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})\b/)
  const month = match && MONTHS.get(match[2])
  return month
    ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`
    : null
}

function normalize(value) {
  return decodeHtml(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[xх]/g, 'x')
    .replace(/[^a-zа-яіїєґ0-9]+/g, '')
}

function normalizedTitle(value = '', showNames = []) {
  let title = value.toLowerCase()
  for (const showName of showNames.sort((a, b) => b.length - a.length)) {
    const prefix = normalize(showName)
    if (prefix && normalize(title).startsWith(prefix)) {
      // Remove the display prefix from the original by words, then normalize.
      const words = showName.trim().split(/\s+/).length
      title = title.trim().split(/\s+/).slice(words).join(' ')
      break
    }
  }
  return normalize(
    title
      .replace(/\b(?:сезон|сезону|season)\s*\d+\b/giu, ' ')
      .replace(/\b(?:епізод|эпизод|episode)\s*\d+\b/giu, ' ')
      .replace(/\bs\s*\d+\s*e\s*\d+\b/giu, ' '),
  )
}

function extractSeasonEpisode(value) {
  const compact = value.match(/\bs\s*(\d+)\s*e\s*(\d+)\b/i)
  if (compact) return { season: Number(compact[1]), episode: Number(compact[2]) }
  const season = value.match(/\b(?:сезон|season)\s*(\d+)\b/iu)
  const episode = value.match(/\b(?:епізод|эпизод|episode)\s*(\d+)\b/iu)
  return season || episode
    ? { season: season ? Number(season[1]) : null, episode: episode ? Number(episode[1]) : null }
    : null
}

function titleScore(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))) return 0.9
  const aPairs = pairs(a)
  const bPairs = pairs(b)
  let common = 0
  const remaining = new Map()
  for (const pair of bPairs) remaining.set(pair, (remaining.get(pair) ?? 0) + 1)
  for (const pair of aPairs) {
    const count = remaining.get(pair) ?? 0
    if (count) {
      common++
      remaining.set(pair, count - 1)
    }
  }
  return (2 * common) / (aPairs.length + bPairs.length)
}

function pairs(value) {
  if (value.length < 2) return [value]
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2))
}

function matchShow(card, dbShows, aliases) {
  const alias = aliases[card.siteSlug]
  if (alias) {
    const row = dbShows.find((show) => show.slug === alias)
    return row ? { row, via: 'alias' } : { error: `alias targets missing slug "${alias}"` }
  }

  const name = normalize(card.title)
  const exact = dbShows.filter((show) => normalize(show.name) === name)
  if (exact.length === 1) return { row: exact[0], via: 'name' }
  if (exact.length > 1) return { error: 'ambiguous normalized name' }

  const prefix = dbShows.filter((show) => {
    const candidate = normalize(show.name)
    return name.length >= 5 && candidate.length >= 5 &&
      (candidate.startsWith(name) || name.startsWith(candidate))
  })
  if (prefix.length === 1) return { row: prefix[0], via: 'prefix' }
  if (prefix.length > 1) return { error: 'ambiguous name prefix' }

  const slug = dbShows.filter((show) => show.slug === slugify(card.title))
  return slug.length === 1 ? { row: slug[0], via: 'slug' } : { error: 'no unique match' }
}

function matchEpisode(siteEpisode, siteEpisodes, dbEpisodes, showNames) {
  const sameDate = dbEpisodes.filter((episode) => episode.date === siteEpisode.date)
  const siteOnDate = siteEpisodes.filter((episode) => episode.date === siteEpisode.date)
  if (sameDate.length === 1 && siteOnDate.length === 1) return sameDate[0]

  const target = normalizedTitle(siteEpisode.title, showNames)
  const candidates = sameDate.length ? sameDate : dbEpisodes
  const ranked = candidates
    .map((episode) => ({
      episode,
      score: titleScore(target, normalizedTitle(episode.title || episode.rawTitle, showNames)),
    }))
    .sort((a, b) => b.score - a.score)
  const threshold = sameDate.length ? 0.68 : 0.84
  if (ranked[0]?.score >= threshold && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.1) {
    return ranked[0].episode
  }

  const se = siteEpisode.seasonEpisode
  if (se) {
    const byNumber = candidates.filter((episode) =>
      (se.season == null || episode.season === se.season) &&
      (se.episode == null || episode.episode === se.episode),
    )
    if (byNumber.length === 1) return byNumber[0]
  }
  return null
}

function addRssDescriptions(siteEpisodes, rssEpisodes) {
  for (const episode of siteEpisodes) {
    if (episode.description) continue
    const candidates = rssEpisodes.filter((rss) => rss.date === episode.date)
    if (candidates.length === 1) {
      episode.description = candidates[0].description
      continue
    }
    const target = normalizedTitle(episode.title)
    const ranked = candidates
      .map((rss) => ({ rss, score: titleScore(target, normalizedTitle(rss.title)) }))
      .sort((a, b) => b.score - a.score)
    if (ranked[0]?.score >= 0.68 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.1) {
      episode.description = ranked[0].rss.description
    }
  }
}

function slugify(name) {
  const translit = {
    а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ie',
    ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh',
    ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'iu', я: 'ia',
  }
  const result = name.toLowerCase().split('').map((char) => translit[char] ?? char).join('')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return result || 'show'
}

async function fetchResponse(url, optional = false) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.ok) return response
      lastError = new Error(`${response.status} ${response.statusText}`)
      if (response.status < 500) break
    } catch (error) {
      lastError = error
    }
    if (attempt === 1) await sleep(250)
  }
  if (optional) return null
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`)
}

async function fetchText(url, optional = false) {
  const response = await fetchResponse(url, optional)
  return response ? response.text() : null
}

async function downloadImage(url, filename) {
  const destination = join(IMAGE_DIR, filename)
  if (existsSync(destination)) return false
  const response = await fetchResponse(url)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    throw new Error(`Expected image from ${url}, got ${contentType || 'unknown content type'}`)
  }
  const temp = `${destination}.tmp`
  try {
    writeFileSync(temp, Buffer.from(await response.arrayBuffer()))
    renameSync(temp, destination)
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp)
    throw error
  }
  return true
}

function imageFilename(showSlug, imageUrl) {
  const extension = extname(new URL(imageUrl).pathname).toLowerCase()
  return `${showSlug}${/^\.(?:avif|gif|jpe?g|png|webp)$/.test(extension) ? extension : '.jpg'}`
}

function readAliases() {
  return JSON.parse(readFileSync(ALIASES_PATH, 'utf8'))
}

async function main() {
  const aliases = readAliases()
  const { db, sqlite } = open()
  const dbShows = sqlite.prepare(
    'SELECT id, slug, name FROM v_shows ORDER BY ord',
  ).all()
  const episodesByShow = new Map()
  for (const row of sqlite.prepare(
    'SELECT id, show_id, raw_title AS rawTitle, title, date, season, episode FROM episodes ORDER BY show_id, ord',
  ).all()) {
    const list = episodesByShow.get(row.show_id) ?? []
    list.push(row)
    episodesByShow.set(row.show_id, list)
  }

  const catalogHtml = await fetchText(CATALOG_URL)
  const cards = parseCatalog(catalogHtml)
  if (!cards.length) throw new Error(`No podcast cards found at ${CATALOG_URL}`)
  const titleCounts = new Map()
  for (const card of cards) {
    const title = normalize(card.title)
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
  }
  mkdirSync(IMAGE_DIR, { recursive: true })

  const stats = {
    cards: cards.length, shows: 0, images: 0, showDescriptions: 0,
    siteEpisodes: 0, matchedEpisodes: 0, episodeDescriptions: 0,
    rssFeeds: 0,
  }
  const unmatchedShows = []
  const unmatchedEpisodes = []
  const imageFailures = []
  const updates = []

  for (const card of cards) {
    if (titleCounts.get(normalize(card.title)) > 1 && !aliases[card.siteSlug]) {
      unmatchedShows.push(`${card.siteSlug} (${card.title}): duplicate title needs an alias`)
      continue
    }
    const match = matchShow(card, dbShows, aliases)
    if (!match.row) {
      unmatchedShows.push(`${card.siteSlug} (${card.title}): ${match.error}`)
      continue
    }
    const show = match.row
    stats.shows++

    await sleep(REQUEST_DELAY_MS)
    const pageHtml = await fetchText(card.siteUrl)
    const page = parseShowPage(pageHtml, card.siteUrl)
    if (page.description) stats.showDescriptions++
    stats.siteEpisodes += page.episodes.length

    let image = null
    const imageErrors = []
    const imageUrls = [...new Set([card.imageUrl, ...page.coverUrls].filter(Boolean))]
    for (const imageUrl of imageUrls) {
      const candidate = imageFilename(show.slug, imageUrl)
      try {
        if (await downloadImage(imageUrl, candidate)) stats.images++
        image = candidate
        break
      } catch (error) {
        imageErrors.push(error.message)
      }
    }
    if (!image && imageUrls.length) {
      imageFailures.push(`${show.slug}: ${imageErrors.join('; ')}`)
    }

    if (page.rssUrl && page.episodes.some((episode) => !episode.description)) {
      await sleep(REQUEST_DELAY_MS)
      const rss = await fetchText(page.rssUrl, true)
      if (rss) {
        stats.rssFeeds++
        addRssDescriptions(page.episodes, parseRss(rss))
      }
    }

    const dbEpisodes = episodesByShow.get(show.id) ?? []
    const episodeUpdates = []
    const usedIds = new Set()
    for (const siteEpisode of page.episodes) {
      const episode = matchEpisode(
        siteEpisode,
        page.episodes,
        dbEpisodes.filter((candidate) => !usedIds.has(candidate.id)),
        [card.title, show.name],
      )
      if (!episode) {
        unmatchedEpisodes.push(`${show.slug} ${siteEpisode.date} ${siteEpisode.title}`)
        continue
      }
      usedIds.add(episode.id)
      stats.matchedEpisodes++
      if (siteEpisode.description) {
        stats.episodeDescriptions++
        episodeUpdates.push({ id: episode.id, description: siteEpisode.description })
      }
    }
    updates.push({ show, card, image, description: page.description, episodeUpdates })
  }

  const write = sqlite.transaction(() => {
    const updateShow = sqlite.prepare(`
      UPDATE shows
      SET image = COALESCE(?, image),
          description = COALESCE(?, description),
          site_url = ?
      WHERE id = ?
    `)
    const updateEpisode = sqlite.prepare(
      'UPDATE episodes SET description = ? WHERE id = ? AND description IS NULL',
    )
    for (const update of updates) {
      updateShow.run(update.image, update.description, update.card.siteUrl, update.show.id)
      for (const episode of update.episodeUpdates) {
        updateEpisode.run(episode.description, episode.id)
      }
    }
  })
  write()

  db.insert(meta)
    .values([
      { key: 'site_imported_at', value: new Date().toISOString() },
      { key: 'site_catalog_url', value: CATALOG_URL },
    ])
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
    .run()

  const storedDescriptions = sqlite.prepare(
    'SELECT COUNT(*) AS n FROM episodes WHERE description IS NOT NULL',
  ).get().n
  const storedImages = sqlite.prepare(
    'SELECT COUNT(*) AS n FROM shows WHERE image IS NOT NULL',
  ).get().n
  sqlite.close()

  console.log(`catalog cards        ${stats.cards}`)
  console.log(`matched shows        ${stats.shows}`)
  console.log(`covers downloaded    ${stats.images}`)
  console.log(`covers stored total  ${storedImages}`)
  console.log(`show descriptions    ${stats.showDescriptions}`)
  console.log(`working RSS feeds    ${stats.rssFeeds}`)
  console.log(`site episode rows    ${stats.siteEpisodes}`)
  console.log(`matched episodes     ${stats.matchedEpisodes}`)
  console.log(`notes found          ${stats.episodeDescriptions}`)
  console.log(`notes stored total   ${storedDescriptions}`)
  console.log(`unmatched shows      ${unmatchedShows.length}`)
  for (const line of unmatchedShows) console.log(`  ${line}`)
  console.log(`failed covers        ${imageFailures.length}`)
  for (const line of imageFailures) console.log(`  ${line}`)
  console.log(`unmatched episodes   ${unmatchedEpisodes.length}`)
  for (const line of unmatchedEpisodes.slice(0, 40)) console.log(`  ${line}`)
  if (unmatchedEpisodes.length > 40) {
    console.log(`  … ${unmatchedEpisodes.length - 40} more`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
