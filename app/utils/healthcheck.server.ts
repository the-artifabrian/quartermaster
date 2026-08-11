import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from './db.server.ts'

export const MINIMUM_DISK_HEADROOM_BYTES = 128n * 1024n * 1024n

// A write statement starts a SQLite write transaction even when its predicate
// matches no rows. That verifies the database connection can write without
// changing application data or growing a probe table every ten seconds.
const DATABASE_WRITE_PROBE = 'UPDATE "User" SET "id" = "id" WHERE 0'

type FileSystemStats = {
	bavail: bigint
	bsize: bigint
}

type HealthcheckDependencies = {
	writeDatabase?: () => Promise<unknown>
	getFileSystemStats?: (volumePath: string) => Promise<FileSystemStats>
	dataVolumePath?: string
	minimumDiskHeadroomBytes?: bigint
}

export function getDataVolumePath() {
	return process.env.DATA_VOLUME_PATH ?? path.dirname(process.env.DATABASE_PATH)
}

export function getAvailableDiskBytes(stats: FileSystemStats) {
	// bavail excludes blocks reserved for the superuser, which is the capacity
	// the application can actually rely on.
	return stats.bavail * stats.bsize
}

export async function assertDatabaseWritable(
	executeRaw: (query: string) => Promise<unknown> = (query) =>
		prisma.$executeRawUnsafe(query),
) {
	await executeRaw(DATABASE_WRITE_PROBE)
}

export async function assertApplicationHealthy({
	writeDatabase = assertDatabaseWritable,
	getFileSystemStats = (volumePath) => statfs(volumePath, { bigint: true }),
	dataVolumePath = getDataVolumePath(),
	minimumDiskHeadroomBytes = MINIMUM_DISK_HEADROOM_BYTES,
}: HealthcheckDependencies = {}) {
	const [, fileSystemStats] = await Promise.all([
		writeDatabase(),
		getFileSystemStats(dataVolumePath),
	])

	const availableDiskBytes = getAvailableDiskBytes(fileSystemStats)
	if (availableDiskBytes < minimumDiskHeadroomBytes) {
		throw new Error(
			`data volume headroom is critically low: ${availableDiskBytes} bytes available, ${minimumDiskHeadroomBytes} required`,
		)
	}

	return { availableDiskBytes }
}
