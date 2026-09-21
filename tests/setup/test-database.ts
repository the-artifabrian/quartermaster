import path from 'node:path'
import { inject } from 'vitest'

/**
 * Each worker gets its own database file inside this run's directory, which the
 * global setup created.
 *
 * The file itself is only created by `db-setup.ts`. A test that reaches for the
 * database without importing that setup fails on a missing table rather than
 * quietly reading the development database.
 */
export const TEST_DATABASE_PATH = path.join(
	inject('databaseRunDirectory'),
	`data.${process.env.VITEST_POOL_ID || '0'}.db`,
)

process.env.DATABASE_URL = `file:${TEST_DATABASE_PATH}`
