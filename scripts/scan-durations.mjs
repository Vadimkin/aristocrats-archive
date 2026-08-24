// Reads every .m4a from the local archive and records its duration, so the
// site can show episode lengths and a total without anyone pressing play.
// The audio itself streams from R2; this only needs the local copy at build
// time. Output is committed, so a normal `npm run build` never needs the disk.
//
// Run: node scripts/scan-durations.mjs [archiveRoot]
//   default root: /Volumes/Vadym  (paths in tracks.json start with "aristocrats/")

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashId } from './lib/hash.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVE = process.argv[2] ?? '/Volumes/Vadym'
const OUT = join(ROOT, 'durations.json')
const CONCURRENCY = 12

function ffprobe(file) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve(null)
        const seconds = Number.parseFloat(stdout.trim())
        resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null)
      },
    )
  })
}

const src = JSON.parse(readFileSync(join(ROOT, 'tracks.json'), 'utf8'))
const tracks = src.shows.flatMap((s) => s.tracks)

// Resume support: a rescan should not redo work that already succeeded.
const durations = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const todo = tracks.filter((t) => durations[hashId(t.path)] == null)

console.log(`${tracks.length} tracks, ${todo.length} to probe (${tracks.length - todo.length} cached)`)

const total = todo.length
let done = 0
let missing = 0
let failed = []

async function worker() {
  for (;;) {
    const track = todo.pop()
    if (!track) return
    const file = join(ARCHIVE, decodeURIComponent(track.path))
    if (!existsSync(file)) {
      missing++
      done++
      continue
    }
    const seconds = await ffprobe(file)
    if (seconds == null) failed.push(track.path)
    else durations[hashId(track.path)] = seconds
    done++
    if (done % 250 === 0) process.stdout.write(`  ${done}/${total} probed\r`)
  }
}

const started = process.hrtime.bigint()
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
const elapsed = Number(process.hrtime.bigint() - started) / 1e9

writeFileSync(OUT, JSON.stringify(durations))

const seconds = Object.values(durations).reduce((a, b) => a + b, 0)
const hours = Math.floor(seconds / 3600)
console.log(`\nprobed in ${elapsed.toFixed(0)}s`)
console.log(`durations   ${Object.keys(durations).length} / ${tracks.length}`)
if (missing) console.log(`missing     ${missing} files not on disk`)
if (failed.length) {
  console.log(`unreadable  ${failed.length}`)
  failed.slice(0, 5).forEach((p) => console.log(`  ${decodeURIComponent(p)}`))
}
console.log(`total       ${hours} h ${Math.round((seconds % 3600) / 60)} min`)
