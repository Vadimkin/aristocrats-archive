// `npm run db:generate` reads this to diff db/schema.js against
// db/migrations/meta/; `db:migrate` and `db:studio` use dbCredentials to open
// the committed database. A normal `npm run build` never invokes drizzle-kit.
export default {
  dialect: 'sqlite',
  schema: './db/schema.js',
  out: './db/migrations',
  dbCredentials: { url: './db/aristocrats.db' },
  strict: true,
  verbose: true,
}
