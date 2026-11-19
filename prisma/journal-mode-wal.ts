/**
 * Puts the database at DATABASE_URL in WAL mode, as production runs it
 * (other/litefs.yml sets WAL after migrating and seeding). The Playwright
 * setup calls this after `prisma migrate deploy` and the infrastructure seed,
 * so the server and the tests' own Prisma writes contend the way they do in
 * production rather than under a rollback journal. Production keeps its own
 * sqlite3 step; this script is for test databases.
 *
 * It refuses a missing file instead of creating an empty one, and prints the
 * mode it set.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL
if (!url?.startsWith('file:')) {
	console.error(`DATABASE_URL must be a file: URL, got ${url ?? 'nothing'}`)
	process.exit(1)
}
const databasePath = path.resolve(url.slice('file:'.length))
// Locally the recipe points DATABASE_URL at a throwaway file in a temp
// directory. Without that export, Bun loads .env and this would switch the
// dev database (prisma/data.db) to WAL, so a database inside the checkout is
// refused outside CI.
if (!process.env.CI && databasePath.startsWith(process.cwd() + path.sep)) {
	console.error(
		`${databasePath} is inside the checkout; point DATABASE_URL at a throwaway e2e database`,
	)
	process.exit(1)
}
if (!existsSync(databasePath)) {
	console.error(`No database at ${databasePath}; migrate and seed it first`)
	process.exit(1)
}
const client = createClient({ url: `file:${databasePath}` })
const result = await client.execute('PRAGMA journal_mode = WAL')
client.close()
const mode = String(result.rows[0]?.journal_mode)
if (mode !== 'wal') {
	console.error(`${databasePath} stayed in ${mode} mode`)
	process.exit(1)
}
console.info(`${databasePath}: journal_mode=${mode}`)
