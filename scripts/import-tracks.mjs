// Seeds db/aristocrats.db from the archive listing.
//
//   scripts/data/{tracks,durations}.json  ->  db/aristocrats.db
//
// This is where every regex in the pipeline runs: the filename is parsed once,
// here, and the result is stored. `npm run data` then only queries. Safe to
// re-run — it upserts on natural keys, so hand fixes in `show_overrides`
// and probed `episodes.duration` both survive.
//
// Run: npm run db:import

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { hashId } from './lib/hash.mjs'
import { open } from './lib/db.mjs'
import {
  restore, extractDate, extractSeasonEpisode, stripShowPrefix, tidy,
  attachHosts, dominantHost, slugify, defaultMaxYear,
} from './lib/derive.mjs'
import { shows, episodes, meta } from '../db/schema.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data')

// ---------------------------------------------------------------- derive

// Everything the DB needs to know about one show, derived from its filenames.
// Kept in memory as a whole because a host phrase only counts as a host if it
// recurs across the show — attachHosts cannot work a row at a time.
function deriveShow(show, ord, seenSlugs, seenIds, maxYear, stats) {
  const displayName = restore(show.name)

  let slug = slugify(displayName)
  if (seenSlugs.has(slug)) {
    const n = seenSlugs.get(slug) + 1
    seenSlugs.set(slug, n)
    slug = `${slug}-${n}`
  }
  seenSlugs.set(slug, seenSlugs.get(slug) ?? 1)

  const eps = []

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

    const { date, year, match: dateMatch } = extractDate(raw, maxYear)
    const { season, episode, matches: seMatches } = extractSeasonEpisode(raw)

    let title = raw
    const before = title
    title = stripShowPrefix(title, displayName)
    if (title !== before) stats.prefixStripped++

    // Remove the bits now held in structured columns.
    for (const m of seMatches) title = title.split(m).join(' ')
    if (dateMatch) title = title.split(dateMatch).join(' ')
    title = tidy(title)

    // Cleanup can eat the whole title because the episode never had one. When
    // the season/episode and date columns already carry everything the
    // filename said, store an empty title and let the row render its own
    // placeholder. With no structured metadata to fall back on, keep the raw.
    if (title.length < 2) {
      title = season != null || episode != null || date ? '' : raw
    }

    // The {t, r, a} shape is what attachHosts mutates; it becomes columns below.
    const ep = { id, t: title, p: track.path, raw }
    if (date) ep.d = date
    if (year) ep.year = year
    if (season != null) ep.s = season
    if (episode != null) ep.e = episode

    eps.push(ep)

    stats.episodes++
    if (date) stats.withDate++
    if (year) stats.withYear++
    if (season != null || episode != null) stats.withSeasonEp++
  }

  const hosts = attachHosts(eps)
  const host = dominantHost(hosts, eps.length)
  for (const n of hosts.values()) stats.hostMoved += n
  if (host) stats.showsWithHost++

  return { ord, slug, name: displayName, sourceName: show.name, host, eps }
}

// ---------------------------------------------------------------- persist

function persist(db, sqlite, derived, legacyDurations) {
  // `ord` and `slug` are UNIQUE, and inserting a show into the middle of
  // tracks.json shifts every ord after it. SQLite enforces uniqueness per
  // statement, not at commit, so park the current values somewhere collision-
  // free before renumbering.
  sqlite.exec('UPDATE shows SET ord = -id, slug = \'~\' || id')
  sqlite.exec('UPDATE episodes SET ord = -rowid')

  sqlite.exec('CREATE TEMP TABLE seen_shows (source_name TEXT PRIMARY KEY)')
  sqlite.exec('CREATE TEMP TABLE seen_episodes (id TEXT PRIMARY KEY)')
  const markShow = sqlite.prepare('INSERT INTO seen_shows VALUES (?)')
  const markEpisode = sqlite.prepare('INSERT INTO seen_episodes VALUES (?)')

  for (const show of derived) {
    // Matching on source_name keeps shows.id stable across re-imports, so the
    // show_overrides rows that point at it stay pointed at the right show.
    const [{ id: showId }] = db
      .insert(shows)
      .values({
        ord: show.ord,
        slug: show.slug,
        name: show.name,
        sourceName: show.sourceName,
        host: show.host,
      })
      .onConflictDoUpdate({
        target: shows.sourceName,
        set: {
          ord: sql`excluded.ord`,
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          host: sql`excluded.host`,
        },
      })
      .returning({ id: shows.id })
      .all()

    markShow.run(show.sourceName)

    // The episode id is a hash of the path, so it is stable by construction —
    // duration and localStorage keys stay pointed at the same row after a re-seed.
    for (const [i, ep] of show.eps.entries()) {
      const row = {
        id: ep.id,
        showId,
        ord: i,
        path: ep.p,
        rawTitle: ep.raw,
        title: ep.t,
        host: ep.a ?? null,
        date: ep.d ?? null,
        year: ep.year ?? null,
        season: ep.s ?? null,
        episode: ep.e ?? null,
      }
      db.insert(episodes)
        .values(row)
        .onConflictDoUpdate({
          target: episodes.id,
          set: {
            showId: sql`excluded.show_id`,
            ord: sql`excluded.ord`,
            path: sql`excluded.path`,
            rawTitle: sql`excluded.raw_title`,
            title: sql`excluded.title`,
            host: sql`excluded.host`,
            date: sql`excluded.date`,
            year: sql`excluded.year`,
            season: sql`excluded.season`,
            episode: sql`excluded.episode`,
          },
        })
        .run()
      markEpisode.run(ep.id)
    }
  }

  const droppedEpisodes = sqlite
    .prepare('DELETE FROM episodes WHERE id NOT IN (SELECT id FROM seen_episodes)')
    .run().changes
  const droppedShows = sqlite
    .prepare(
      'DELETE FROM shows WHERE source_name NOT IN (SELECT source_name FROM seen_shows)',
    )
    .run().changes

  sqlite.exec('DROP TABLE seen_shows; DROP TABLE seen_episodes')

  // One-time carry-over of the committed ffprobe results. Only fills a NULL
  // duration, so an already-measured length always wins. probed_at stays NULL
  // for these: they were not probed on this machine.
  let seededDurations = 0
  if (legacyDurations) {
    const fill = sqlite.prepare(
      'UPDATE episodes SET duration = ? WHERE id = ? AND duration IS NULL',
    )
    for (const [id, seconds] of Object.entries(legacyDurations)) {
      if (seconds > 0) seededDurations += fill.run(seconds, id).changes
    }
  }

  return { droppedShows, droppedEpisodes, seededDurations }
}

// ------------------------------------------------------------------ main

function main() {
  const tracksPath = join(DATA, 'tracks.json')
  const raw = readFileSync(tracksPath)
  const src = JSON.parse(raw.toString('utf8'))

  const durationsPath = join(DATA, 'durations.json')
  const legacyDurations = existsSync(durationsPath)
    ? JSON.parse(readFileSync(durationsPath, 'utf8'))
    : null

  const maxYear = defaultMaxYear()
  const stats = {
    episodes: 0, withDate: 0, withYear: 0, withSeasonEp: 0,
    prefixStripped: 0, hostMoved: 0, showsWithHost: 0,
  }
  const seenSlugs = new Map()
  const seenIds = new Map()

  const derived = src.shows.map((show, i) =>
    deriveShow(show, i, seenSlugs, seenIds, maxYear, stats),
  )

  const { db, sqlite } = open()
  const counts = sqlite.transaction(() =>
    persist(db, sqlite, derived, legacyDurations),
  )()

  db.insert(meta)
    .values([
      { key: 'imported_at', value: new Date().toISOString() },
      { key: 'source_sha256', value: createHash('sha256').update(raw).digest('hex') },
      { key: 'max_year', value: String(maxYear) },
    ])
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } })
    .run()

  report(sqlite, stats, counts)

  // The .db is committed, so keep it compact: an upsert-and-delete pass leaves
  // free pages behind. Has to be outside the transaction above.
  sqlite.exec('VACUUM')
  sqlite.close()
}

function report(sqlite, stats, counts) {
  const pct = (n) => `${((n / stats.episodes) * 100).toFixed(1)}%`
  const one = (q) => sqlite.prepare(q).get()

  const withLen = one('SELECT COUNT(*) AS n FROM episodes WHERE duration IS NOT NULL').n
  const seconds = one('SELECT COALESCE(SUM(duration), 0) AS n FROM episodes').n
  const showCount = one('SELECT COUNT(*) AS n FROM shows').n
  const byEra = sqlite
    .prepare('SELECT era, COUNT(*) AS n FROM v_show_index GROUP BY era')
    .all()

  console.log(`shows              ${showCount}`)
  console.log(`episodes           ${stats.episodes}`)
  console.log(`  with full date   ${stats.withDate} (${pct(stats.withDate)})`)
  console.log(`  with a year      ${stats.withYear} (${pct(stats.withYear)})`)
  console.log(`  with season/ep   ${stats.withSeasonEp} (${pct(stats.withSeasonEp)})`)
  console.log(`  prefix stripped  ${stats.prefixStripped} (${pct(stats.prefixStripped)})`)
  console.log(`  with duration    ${withLen} (${pct(withLen)})`)
  console.log(`  host pulled out  ${stats.hostMoved} (${pct(stats.hostMoved)})`)
  console.log(`shows with a host  ${stats.showsWithHost}`)
  console.log(`eras               ${JSON.stringify(Object.fromEntries(byEra.map((r) => [r.era, r.n])))}`)
  console.log(`total runtime      ${Math.floor(seconds / 3600)} h`)
  if (counts.seededDurations) {
    console.log(`seeded durations   ${counts.seededDurations} from durations.json`)
  }
  if (counts.droppedShows || counts.droppedEpisodes) {
    console.log(`removed            ${counts.droppedShows} shows, ${counts.droppedEpisodes} episodes no longer in the archive`)
  }
}

main()
