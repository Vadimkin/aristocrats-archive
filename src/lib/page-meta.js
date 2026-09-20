import { episodeWord, fullShowName, yearSpan } from './format.js'

export const SITE = 'Архів Аристократів'
export const SITE_DESCRIPTION =
  'Архів Аристократів — фан-каталог подкастів інтернет-радіостанції'
export const SITE_ORIGIN = 'https://aristocrats-archive.kyiv.ua'

export const SETTINGS_TITLE = 'Налаштування'
export const SETTINGS_DESCRIPTION =
  'Експорт і імпорт історії прослуховувань. Дані зберігаються в браузері та нікуди не надсилаються.'

export const NOT_FOUND_TITLE = 'Не знайдено'
export const NOT_FOUND_DESCRIPTION = 'Такої сторінки в архіві немає.'
export const SHOW_NOT_FOUND_DESCRIPTION = 'Такого шоу в архіві немає.'

export const OG_IMAGE = 'studio-header.webp'
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 570

const DESCRIPTION_MAX = 200

export function clipDescription(text) {
  const oneLine = String(text).replace(/\s+/g, ' ').trim()
  if (oneLine.length <= DESCRIPTION_MAX) return oneLine
  const cut = oneLine.slice(0, DESCRIPTION_MAX - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > 140 ? cut.slice(0, at) : cut).replace(/[.,;:–—-]+$/, '')}…`
}

export function showDescription(show) {
  const desc = show.desc?.replace(/\s+/g, ' ').trim()
  if (desc) return clipDescription(desc)

  const n = show.n ?? show.episodes?.length
  let years = yearSpan(show.y0, show.y1)
  if (!years && show.episodes) {
    const ys = show.episodes.map((e) => (e.d ? +e.d.slice(0, 4) : e.y)).filter(Boolean)
    if (ys.length) years = yearSpan(Math.min(...ys), Math.max(...ys))
  }
  const parts = []
  if (n) parts.push(`${n} ${episodeWord(n)}`)
  if (years) parts.push(years)
  return parts.length ? `${parts.join(' · ')} — архів Аристократів` : SITE_DESCRIPTION
}

export function imageType(url) {
  const ext = String(url).split('?')[0].split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'avif') return 'image/avif'
  return 'image/jpeg'
}

export function absUrl(origin, base, path = '/') {
  const a = origin.replace(/\/$/, '')
  const b = base.replace(/\/$/, '')
  if (!path || path === '/') return `${a}${b}/`
  return `${a}${b}${path.startsWith('/') ? path : `/${path}`}`
}

export function absAsset(origin, base, file) {
  const a = origin.replace(/\/$/, '')
  const b = base.endsWith('/') ? base : `${base}/`
  return `${a}${b}${String(file).replace(/^\//, '')}`
}

function studioImage(origin, base) {
  return {
    image: absAsset(origin, base, OG_IMAGE),
    imageType: 'image/webp',
    imageWidth: OG_IMAGE_WIDTH,
    imageHeight: OG_IMAGE_HEIGHT,
    imageAlt: SITE,
    card: 'summary_large_image',
  }
}

export function homePage(origin, base) {
  return {
    title: SITE,
    tabTitle: SITE,
    description: SITE_DESCRIPTION,
    url: absUrl(origin, base, '/'),
    ...studioImage(origin, base),
  }
}

export function settingsPage(origin, base) {
  return {
    title: SETTINGS_TITLE,
    description: SETTINGS_DESCRIPTION,
    url: absUrl(origin, base, '/settings'),
    ...studioImage(origin, base),
  }
}

export function notFoundPage(origin, base) {
  return {
    title: NOT_FOUND_TITLE,
    description: NOT_FOUND_DESCRIPTION,
    url: absUrl(origin, base, '/'),
    ...studioImage(origin, base),
  }
}

export function showPage(show, origin, base, coverFile) {
  const title = fullShowName(show)
  const page = {
    title,
    description: showDescription(show),
    url: absUrl(origin, base, `/show/${show.slug}`),
  }
  if (!coverFile) return { ...page, ...studioImage(origin, base) }
  return {
    ...page,
    image: absAsset(origin, base, coverFile),
    imageType: imageType(coverFile),
    imageAlt: title,
    card: 'summary',
  }
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

export function socialMetaTags(page) {
  const lines = [
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(page.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="uk_UA" />`,
    `<meta property="og:site_name" content="${esc(SITE)}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(page.url)}" />`,
    `<meta property="og:image" content="${esc(page.image)}" />`,
    `<meta property="og:image:type" content="${esc(page.imageType)}" />`,
  ]
  if (page.imageWidth) lines.push(`<meta property="og:image:width" content="${page.imageWidth}" />`)
  if (page.imageHeight) lines.push(`<meta property="og:image:height" content="${page.imageHeight}" />`)
  lines.push(
    `<meta property="og:image:alt" content="${esc(page.imageAlt)}" />`,
    `<meta name="twitter:card" content="${esc(page.card)}" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${esc(page.image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(page.imageAlt)}" />`,
  )
  return lines.map((line) => `    ${line}`).join('\n')
}

export function applyPage(html, page) {
  const tab = page.tabTitle ?? `${page.title} | ${SITE}`
  const block = `<!-- social-meta -->\n${socialMetaTags(page)}\n    <!-- /social-meta -->`
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(tab)}</title>`)
    .replace(/<!-- social-meta -->[\s\S]*?<!-- \/social-meta -->/, block)
}

function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

function setOptionalMeta(attr, key, value) {
  const el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (value == null || value === '') {
    el?.remove()
    return
  }
  setMeta(attr, key, String(value))
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export function syncDocumentMeta(page) {
  setMeta('name', 'description', page.description)
  setCanonical(page.url)
  setMeta('property', 'og:title', page.title)
  setMeta('property', 'og:description', page.description)
  setMeta('property', 'og:url', page.url)
  setMeta('property', 'og:image', page.image)
  setOptionalMeta('property', 'og:image:type', page.imageType)
  setOptionalMeta('property', 'og:image:width', page.imageWidth)
  setOptionalMeta('property', 'og:image:height', page.imageHeight)
  setOptionalMeta('property', 'og:image:alt', page.imageAlt)
  setMeta('name', 'twitter:card', page.card)
  setMeta('name', 'twitter:title', page.title)
  setMeta('name', 'twitter:description', page.description)
  setMeta('name', 'twitter:image', page.image)
  setOptionalMeta('name', 'twitter:image:alt', page.imageAlt)
}
