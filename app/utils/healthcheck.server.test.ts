import { chmod, stat } from 'node:fs/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createPrismaClient, prisma } from './db.server.ts'
import {
	assertApplicationHealthy,
	assertDatabaseWritable,
	getAvailableDiskBytes,
} from './healthcheck.server.ts'

const VOLUME_PATH = '/data'
const ONE_MEBIBYTE = 1024n * 1024n

function fileSystemStats(availableMebibytes: bigint) {
	return {
		bavail: availableMebibytes,
		bsize: ONE_MEBIBYTE,
	}
}

describe('healthcheck', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('passes after local resource probes without making an HTTP request', async () => {
		const writeDatabase = vi.fn().mockResolvedValue(undefined)
		const getFileSystemStats = vi.fn().mockResolvedValue(fileSystemStats(512n))
		const fetchSpy = vi.spyOn(globalThis, 'fetch')

		await expect(
			assertApplicationHealthy({
				writeDatabase,
				getFileSystemStats,
				dataVolumePath: VOLUME_PATH,
				minimumDiskHeadroomBytes: 128n * ONE_MEBIBYTE,
			}),
		).resolves.toEqual({ availableDiskBytes: 512n * ONE_MEBIBYTE })

		expect(writeDatabase).toHaveBeenCalledOnce()
		expect(getFileSystemStats).toHaveBeenCalledWith(VOLUME_PATH)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('fails when the database write probe fails', async () => {
		const databaseError = new Error('attempt to write a readonly database')

		await expect(
			assertApplicationHealthy({
				writeDatabase: vi.fn().mockRejectedValue(databaseError),
				getFileSystemStats: vi.fn().mockResolvedValue(fileSystemStats(512n)),
				dataVolumePath: VOLUME_PATH,
			}),
		).rejects.toBe(databaseError)
	})

	test('the real write probe rejects a read-only SQLite connection', async () => {
		const databaseUrl = process.env.DATABASE_URL
		const databasePath = databaseUrl.replace(/^file:/, '')
		const originalMode = (await stat(databasePath)).mode
		await prisma.$disconnect()
		await chmod(databasePath, 0o444)
		const readOnlyPrisma = createPrismaClient(databaseUrl)

		try {
			await readOnlyPrisma.$connect()
			await expect(
				assertDatabaseWritable((query) =>
					readOnlyPrisma.$executeRawUnsafe(query),
				),
			).rejects.toThrow(/readonly/i)
		} finally {
			await readOnlyPrisma.$disconnect()
			await chmod(databasePath, originalMode)
		}
	})

	test('the real write probe rejects a connection that becomes read-only', async () => {
		const client = createPrismaClient()

		try {
			await client.$connect()
			await client.$queryRawUnsafe('PRAGMA query_only = ON')
			await expect(
				assertDatabaseWritable((query) => client.$executeRawUnsafe(query)),
			).rejects.toThrow(/readonly/i)
		} finally {
			await client.$queryRawUnsafe('PRAGMA query_only = OFF')
			await client.$disconnect()
		}
	})

	test('fails below the minimum disk headroom and passes at the boundary', async () => {
		const writeDatabase = vi.fn().mockResolvedValue(undefined)
		const minimumDiskHeadroomBytes = 128n * ONE_MEBIBYTE

		await expect(
			assertApplicationHealthy({
				writeDatabase,
				getFileSystemStats: vi.fn().mockResolvedValue(fileSystemStats(127n)),
				dataVolumePath: VOLUME_PATH,
				minimumDiskHeadroomBytes,
			}),
		).rejects.toThrow('data volume headroom is critically low')

		await expect(
			assertApplicationHealthy({
				writeDatabase,
				getFileSystemStats: vi.fn().mockResolvedValue(fileSystemStats(128n)),
				dataVolumePath: VOLUME_PATH,
				minimumDiskHeadroomBytes,
			}),
		).resolves.toEqual({ availableDiskBytes: minimumDiskHeadroomBytes })
	})

	test('uses blocks available to the application when calculating headroom', () => {
		expect(getAvailableDiskBytes({ bavail: 3n, bsize: 4096n })).toBe(12_288n)
	})
})
