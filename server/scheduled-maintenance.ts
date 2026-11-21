import { startOfUsageDay } from '#app/utils/ai-rate-limit.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	getImageCacheDir,
	pruneImageCache,
	type ImageCachePruneSummary,
} from '#app/utils/image-cache.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { serializeError } from '#app/utils/serialize-error.server.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUSEHOLD_EVENT_RETENTION_DAYS = 30
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000

export type MaintenanceSummary = {
	sessions: number
	verifications: number
	emailCodes: number
	usageEvents: number
	householdEvents: number
}

export async function pruneExpiredData(
	now = new Date(),
): Promise<MaintenanceSummary> {
	// The same daily window claimAiUsage counts in.
	const usageCutoff = startOfUsageDay(now)
	const householdEventCutoff = new Date(
		now.getTime() - HOUSEHOLD_EVENT_RETENTION_DAYS * DAY_MS,
	)

	const [sessions, verifications, emailCodes, usageEvents, householdEvents] =
		await prisma.$transaction([
			prisma.session.deleteMany({
				where: { expirationDate: { lte: now } },
			}),
			prisma.verification.deleteMany({
				where: { expiresAt: { lte: now } },
			}),
			prisma.emailCode.deleteMany({
				where: { expiresAt: { lte: now } },
			}),
			prisma.usageEvent.deleteMany({
				where: { createdAt: { lt: usageCutoff } },
			}),
			prisma.householdEvent.deleteMany({
				where: { createdAt: { lt: householdEventCutoff } },
			}),
		])

	return {
		sessions: sessions.count,
		verifications: verifications.count,
		emailCodes: emailCodes.count,
		usageEvents: usageEvents.count,
		householdEvents: householdEvents.count,
	}
}

async function pruneResizedImages() {
	return pruneImageCache({ dir: await getImageCacheDir() })
}

function reportMaintenanceFailure(error: unknown) {
	captureServerEvent('server', 'server_error', {
		error: serializeError(error),
		stack: error instanceof Error ? error.stack : undefined,
		operation: 'scheduled_maintenance',
	})
}

type ScheduledMaintenanceOptions = {
	intervalMs?: number
	prune?: () => Promise<MaintenanceSummary>
	pruneImages?: () => Promise<ImageCachePruneSummary>
	log?: (message: string) => void
	logError?: (message: string) => void
	reportFailure?: (error: unknown) => void
}

export function startScheduledMaintenance({
	intervalMs = MAINTENANCE_INTERVAL_MS,
	prune = pruneExpiredData,
	pruneImages = pruneResizedImages,
	log = console.log,
	logError = console.error,
	reportFailure = reportMaintenanceFailure,
}: ScheduledMaintenanceOptions = {}) {
	let running = false
	// Each step logs and reports its own failure, so one failing (a full
	// volume can fail the database deletes) doesn't skip the other.
	const step = async (label: string, work: () => Promise<string>) => {
		const startedAt = Date.now()
		try {
			const summary = await work()
			log(`🧹 ${label}: ${summary} duration_ms=${Date.now() - startedAt}`)
		} catch (error) {
			let reportingError: unknown
			try {
				reportFailure(error)
			} catch (caught) {
				reportingError = caught
			}
			logError(
				`🧹 ${label}: failed error=${serializeError(error)} duration_ms=${Date.now() - startedAt}${reportingError === undefined ? '' : ` reporting_error=${serializeError(reportingError)}`}`,
			)
		}
	}
	const run = async () => {
		if (running) return
		running = true
		try {
			await step('maintenance', async () => {
				const result = await prune()
				return `sessions=${result.sessions} verifications=${result.verifications} email_codes=${result.emailCodes} usage_events=${result.usageEvents} household_events=${result.householdEvents}`
			})
			await step('image cache', async () => {
				const result = await pruneImages()
				return `removed_files=${result.removedFiles} removed_bytes=${result.removedBytes} kept_bytes=${result.keptBytes} skipped=${result.skipped}`
			})
		} finally {
			running = false
		}
	}

	void run()
	const timer = setInterval(() => void run(), intervalMs)
	timer.unref?.()
	return timer
}
