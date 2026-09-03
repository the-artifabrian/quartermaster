import { prisma } from '#app/utils/db.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { serializeError } from '#app/utils/serialize-error.server.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUSEHOLD_EVENT_RETENTION_DAYS = 30
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000

export type MaintenanceSummary = {
	sessions: number
	verifications: number
	usageEvents: number
	householdEvents: number
}

export async function pruneExpiredData(
	now = new Date(),
): Promise<MaintenanceSummary> {
	const usageCutoff = new Date(now)
	// Match checkAndRecordAiUsage's local-calendar daily window exactly.
	usageCutoff.setHours(0, 0, 0, 0)
	const householdEventCutoff = new Date(
		now.getTime() - HOUSEHOLD_EVENT_RETENTION_DAYS * DAY_MS,
	)

	const [sessions, verifications, usageEvents, householdEvents] =
		await prisma.$transaction([
			prisma.session.deleteMany({
				where: { expirationDate: { lte: now } },
			}),
			prisma.verification.deleteMany({
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
		usageEvents: usageEvents.count,
		householdEvents: householdEvents.count,
	}
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
	log?: (message: string) => void
	logError?: (message: string) => void
	reportFailure?: (error: unknown) => void
}

export function startScheduledMaintenance({
	intervalMs = MAINTENANCE_INTERVAL_MS,
	prune = pruneExpiredData,
	log = console.log,
	logError = console.error,
	reportFailure = reportMaintenanceFailure,
}: ScheduledMaintenanceOptions = {}) {
	let running = false
	const run = async () => {
		if (running) return
		running = true
		const startedAt = Date.now()
		try {
			const result = await prune()
			log(
				`🧹 maintenance: sessions=${result.sessions} verifications=${result.verifications} usage_events=${result.usageEvents} household_events=${result.householdEvents} duration_ms=${Date.now() - startedAt}`,
			)
		} catch (error) {
			let reportingError: unknown
			try {
				reportFailure(error)
			} catch (caught) {
				reportingError = caught
			}
			logError(
				`🧹 maintenance: failed error=${serializeError(error)} duration_ms=${Date.now() - startedAt}${reportingError === undefined ? '' : ` reporting_error=${serializeError(reportingError)}`}`,
			)
		} finally {
			running = false
		}
	}

	void run()
	const timer = setInterval(() => void run(), intervalMs)
	timer.unref?.()
	return timer
}
