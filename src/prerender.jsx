import { App } from './main.jsx'

// Same-origin links the plugin should render next. External and
// target="_blank" credits stay out of the crawl.
function pageLinks(html) {
  const links = new Set()
  for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
    const href = /href="([^"]*)"/.exec(tag)?.[1]
    const target = /target="([^"]*)"/.exec(tag)?.[1]
    if (!href || (target && target !== '_self')) continue
    links.add(href)
  }
  return links
}

// Called by @preact/preset-vite while building. Renders the real app for one
// URL and hands back the links it found, which the plugin follows.
export async function prerender(data) {
  const { renderToString } = await import('preact-render-to-string')
  const html = renderToString(<App ssrPath={data.url} />)
  return { html, links: pageLinks(html) }
}
