// Opens db/aristocrats.db. Every script that touches the archive goes through
// here so the connection PRAGMAs and the migration check are in one place.
//
// SQLite defaults `foreign_keys` to OFF *per connection* and drizzle-kit does
// not emit a PRAGMA into a migration, so without the line below every
// ON DELETE CASCADE in the schema would be decorative.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../../db/schema.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DB_PATH = join(ROOT, 'db', 'aristocrats.db')
const MIGRATIONS = join(ROOT, 'db', 'migrations')

function connect(opts) {
  const sqlite = new Database(DB_PATH, opts)
  sqlite.pragma('foreign_keys = ON')
  return { sqlite, db: drizzle(sqlite, { schema }) }
}

// Read-write. Creates the file if absent and brings it to the head migration,
// so a fresh clone and a stale checkout both work without a separate step.
export function open() {
  const handle = connect({})
  migrate(handle.db, { migrationsFolder: MIGRATIONS })
  return handle
}

// Read-only, for the exporter. A read-only connection cannot migrate, so
// instead of silently exporting from a stale schema it fails loudly.
export function openReadOnly() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`No database at ${DB_PATH} — run: npm run db:import`)
  }
  const handle = connect({ readonly: true })
  assertMigrated(handle.sqlite)
  return handle
}

function assertMigrated(sqlite) {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  )
  const head = journal.entries.at(-1)
  if (!head) return

  // drizzle's own bookkeeping table; absent means nothing was ever applied.
  const exists = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get('__drizzle_migrations')
  const at = exists
    ? sqlite.prepare('SELECT MAX(created_at) AS at FROM __drizzle_migrations').get().at
    : null

  if (at == null || at < head.when) {
    throw new Error(
      `Database is behind migration ${head.tag} — run: npm run db:migrate`,
    )
  }
}
