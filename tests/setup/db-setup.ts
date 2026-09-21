/**
 * Import this from any test that reads or writes the database:
 *
 * ```ts
 * import '#tests/setup/db-setup.ts'
 * ```
 *
 * It restores a freshly seeded database before every test in the file. Tests
 * that never touch the database skip the import and the copying that goes with
 * it.
 */

import fs from 'node:fs/promises'
import { afterAll, beforeEach } from 'vitest'
import { BASE_DATABASE_PATH } from './database-paths.ts'
import { TEST_DATABASE_PATH } from './test-database.ts'

beforeEach(async () => {
	// Disconnect Prisma so SQLite releases file handles and page caches.
	// Without this, the open connection may read stale cached pages after
	// the database file is replaced, causing FK violations and null reads.
	const { prisma } = await import('#app/utils/db.server.ts')
	await prisma.$disconnect()
	// Remove stale SQLite WAL/SHM sidecar files from the previous test.
	await fs.rm(`${TEST_DATABASE_PATH}-wal`, { force: true })
	await fs.rm(`${TEST_DATABASE_PATH}-shm`, { force: true })
	await fs.copyFile(BASE_DATABASE_PATH, TEST_DATABASE_PATH)
})

afterAll(async () => {
	// we *must* use dynamic imports here so the process.env.DATABASE_URL is set
	// before prisma is imported and initialized
	const { prisma } = await import('#app/utils/db.server.ts')
	await prisma.$disconnect()
	await fs.rm(TEST_DATABASE_PATH, { force: true })
})
