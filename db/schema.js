// The archive's schema. Source of truth — `npm run db:generate` diffs this file
// against db/migrations/meta/ and writes the migration; nothing here is applied
// to db/aristocrats.db until `npm run db:migrate` runs.
//
// Four groups of tables, and the difference between them is what survives a
// re-seed:
//   derived      shows, episodes            — rebuilt by import-tracks.mjs
//                                             (duration / probed_at are not)
//   accumulated  episodes.duration          — never wiped on re-seed
//   overrides    show_overrides             — hand fixes, layered on by the views
//   config       eras, meta                 — reference data and provenance

import { sql } from 'drizzle-orm'
import {
  sqliteTable, sqliteView, text, integer, unique, check,
} from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------- derived

export const shows = sqliteTable('shows', {
  id: integer('id').primaryKey(),
  // Position in tracks.json. search.json is emitted in this order and the
  // frontend caps results at 60, so the order is user-visible.
  ord: integer('ord').notNull().unique(),
  slug: text('slug').notNull().unique(),
  // Glyph-restored display name.
  name: text('name').notNull(),
  // Verbatim tracks.json name — the key a re-import matches on.
  sourceName: text('source_name').notNull().unique(),
  // Dominant host phrase ("з Олексієм Коганом"), NULL for most shows.
  host: text('host'),
})

export const episodes = sqliteTable(
  'episodes',
  {
    // hashId(path). This is the localStorage key for every played-mark and
    // resume position in every browser that has ever loaded the site.
    // It must never be regenerated. See scripts/lib/hash.mjs.
    id: text('id').primaryKey(),
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    // Position within the show in tracks.json — the final sort tiebreak.
    ord: integer('ord').notNull(),
    // Percent-encoded R2 object path. Also the hash input: do not normalize.
    path: text('path').notNull().unique(),
    rawTitle: text('raw_title').notNull(),
    // Cleaned title. '' is a real value, not a missing one: it means the
    // filename said nothing beyond season/episode and date, and the row
    // renders "Без назви". Empty titles are also skipped from search.
    title: text('title').notNull(),
    // Per-episode host phrase, when the show repeats one.
    host: text('host'),
    date: text('date'),
    // Set whenever a year could be read, including when `date` is also set —
    // the show's year span is a MIN/MAX over this column.
    year: integer('year'),
    season: integer('season'),
    episode: integer('episode'),
    // Seeded from scripts/data/durations.json. import-tracks.mjs never overwrites a
    // non-NULL value, so a re-seed does not lose measured lengths.
    duration: integer('duration'),
    probedAt: text('probed_at'),
  },
  (t) => [
    // Serves both the uniqueness guarantee and every (show_id, ord) lookup;
    // a separate non-unique index on the same columns would be dead weight.
    unique('episodes_show_ord').on(t.showId, t.ord),
    check('episodes_date_iso', sql`${t.date} IS NULL OR ${t.date} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check('episodes_duration_positive', sql`${t.duration} IS NULL OR ${t.duration} > 0`),
  ],
)

// -------------------------------------------------------------- overrides

// Hand fixes for what the filename parser got wrong. NULL means "no opinion,
// use the derived value" — the v_* views COALESCE these over the derived
// columns, so an override takes effect on the next `npm run data` with no
// re-import, and survives one.

export const showOverrides = sqliteTable('show_overrides', {
  showId: integer('show_id')
    .primaryKey()
    .references(() => shows.id, { onDelete: 'cascade' }),
  slug: text('slug'),
  name: text('name'),
  host: text('host'),
})

// ----------------------------------------------------------------- config

// Shows are grouped by the year of their most recent episode. Seeded by
// migration 0001, not by the importer, so a label change is a migration.
export const eras = sqliteTable('eras', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  // NULL/NULL marks the catch-all bucket for shows with no dated episode.
  yearFrom: integer('year_from'),
  yearTo: integer('year_to'),
  ord: integer('ord').notNull(),
})

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// ------------------------------------------------------------------ views
//
// Created by migration 0001 (hand-written --custom SQL); v_episodes was
// rebuilt in 0002 (no episode_overrides) and 0003 (duration lives on
// episodes). A view is not diffable:
// changing one means DROP + CREATE, which should be an explicit migration.
// Declared .existing() here so queries can select from them.
// v_search's ORDER BY is part of the output contract — see README.

export const vShows = sqliteView('v_shows', {
  id: integer('id'),
  ord: integer('ord'),
  slug: text('slug'),
  name: text('name'),
  host: text('host'),
}).existing()

export const vEpisodes = sqliteView('v_episodes', {
  id: text('id'),
  showId: integer('show_id'),
  ord: integer('ord'),
  path: text('path'),
  rawTitle: text('raw_title'),
  title: text('title'),
  host: text('host'),
  date: text('date'),
  year: integer('year'),
  season: integer('season'),
  episode: integer('episode'),
  duration: integer('duration'),
}).existing()

export const vShowIndex = sqliteView('v_show_index', {
  id: integer('id'),
  ord: integer('ord'),
  slug: text('slug'),
  name: text('name'),
  host: text('host'),
  n: integer('n'),
  secs: integer('secs'),
  y0: integer('y0'),
  y1: integer('y1'),
  era: text('era'),
}).existing()

export const vSearch = sqliteView('v_search', {
  slug: text('slug'),
  id: text('id'),
  title: text('title'),
  host: text('host'),
  date: text('date'),
  // Not emitted — the exporter orders on these. See migration 0001.
  showOrd: integer('show_ord'),
  ord: integer('ord'),
}).existing()
