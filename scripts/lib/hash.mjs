/**
 * FNV-1a over the file path — the only stable unique key in the source data.
 * localStorage keys on the result, so it must not drift between rebuilds.
 * Shared by build-data.mjs and scan-durations.mjs so both agree.
 */
export function hashId(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Second pass over the reverse widens the space beyond 32 bits.
  let g = 0x9dc5811c
  for (let i = str.length - 1; i >= 0; i--) {
    g ^= str.charCodeAt(i)
    g = Math.imul(g, 0x85ebca6b) >>> 0
  }
  return (h.toString(36) + g.toString(36).padStart(7, '0')).slice(0, 12)
}
