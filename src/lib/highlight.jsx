/** Wrap every case-insensitive occurrence of `query` in <mark>. */
export function Highlight({ text, query }) {
  if (!query) return text

  const haystack = text.toLowerCase()
  const parts = []
  let from = 0

  for (;;) {
    const at = haystack.indexOf(query, from)
    if (at < 0) {
      parts.push(text.slice(from))
      break
    }
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={at}>{text.slice(at, at + query.length)}</mark>)
    from = at + query.length
  }

  return <>{parts}</>
}
