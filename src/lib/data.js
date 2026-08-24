const base = import.meta.env.BASE_URL
const cache = new Map()

// One in-flight promise per URL: several components ask for the same show JSON
// on first render, and the search index is 400 KB.
function load(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(base + url).then((r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`)
        return r.json()
      }).catch((err) => {
        cache.delete(url)
        throw err
      }),
    )
  }
  return cache.get(url)
}

export const loadIndex = () => load('data/index.json')
export const loadShow = (slug) => load(`data/shows/${encodeURIComponent(slug)}.json`)
export const loadSearchIndex = () => load('data/search.json')
