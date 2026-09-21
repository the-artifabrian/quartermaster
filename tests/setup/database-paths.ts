import path from 'node:path'

const TEST_PRISMA_DIRECTORY = path.join(process.cwd(), './tests/prisma')

/**
 * The migrated and seeded template every worker database is copied from.
 * Shared between runs, so it is only ever replaced atomically.
 */
export const BASE_DATABASE_PATH = path.join(TEST_PRISMA_DIRECTORY, 'base.db')

/**
 * Worker databases live in a subdirectory unique to their run, so two runs
 * started at the same time cannot overwrite or clean up one another's files.
 */
export const RUNS_DIRECTORY = path.join(TEST_PRISMA_DIRECTORY, 'runs')
