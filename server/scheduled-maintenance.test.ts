import { afterEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	type DemoExpirySummary,
	type DemoTemplateSummary,
} from '#app/utils/demo.server.ts'
import { type ImageCachePruneSummary } from '#app/utils/image-cache.server.ts'
import {
	pruneExpiredData,
	startScheduledMaintenance,
	type MaintenanceSummary,
} from './scheduled-maintenance.ts'
import '#tests/setup/db-setup.ts'

const EMPTY_SUMMARY: MaintenanceSummary = {
	sessions: 0,
	verifications: 0,
	emailCodes: 0,
	usageEvents: 0,
	demoAiUses: 0,
	householdEvents: 0,
}

const EMPTY_IMAGE_CACHE: ImageCachePruneSummary = {
	removedFiles: 0,
	removedBytes: 0,
	keptBytes: 0,
	skipped: 0,
}
const pruneImages = async () => EMPTY_IMAGE_CACHE

const CURRENT_TEMPLATE: DemoTemplateSummary = {
	status: 'current',
	userId: 'template-user',
	householdId: 'template-household',
	missingPhotos: [],
	abandoned: 0,
}
const buildDemoTemplate = async () => CURRENT_TEMPLATE
const NO_EXPIRED_DEMOS: DemoExpirySummary = { deleted: 0, failed: 0 }
const expireDemos = async () => NO_EXPIRED_DEMOS

afterEach(() => {
	vi.useRealTimers()
})

describe('pruneExpiredData', () => {
	test('prunes expired data while preserving active retention windows', async () => {
		const now = new Date(2026, 8, 3, 12)
		const startOfDay = new Date(2026, 8, 3)
		const eventCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		const user = await prisma.user.create({ data: createUser() })
		const household = await prisma.household.create({
			data: {
				name: 'Maintenance Test Household',
				members: { create: { userId: user.id, role: 'owner' } },
			},
		})

		await prisma.session.createMany({
			data: [
				{
					id: 'expired-session',
					userId: user.id,
					expirationDate: now,
				},
				{
					id: 'active-session',
					userId: user.id,
					expirationDate: new Date(now.getTime() + 1),
				},
			],
		})
		await prisma.verification.createMany({
			data: [
				{
					id: 'expired-verification',
					type: 'maintenance-test',
					target: 'expired',
					secret: 'secret',
					algorithm: 'SHA-256',
					digits: 6,
					period: 600,
					charSet: '0123456789',
					expiresAt: now,
				},
				{
					id: 'active-verification',
					type: 'maintenance-test',
					target: 'active',
					secret: 'secret',
					algorithm: 'SHA-256',
					digits: 6,
					period: 600,
					charSet: '0123456789',
					expiresAt: new Date(now.getTime() + 1),
				},
				{
					id: 'nonexpiring-verification',
					type: 'maintenance-test',
					target: 'nonexpiring',
					secret: 'secret',
					algorithm: 'SHA-256',
					digits: 6,
					period: 600,
					charSet: '0123456789',
					expiresAt: null,
				},
			],
		})
		const emailCode = {
			type: 'reset-password',
			target: 'maintenance-test',
			codeHash: 'hash',
			linkTokenHash: 'hash',
			sentAt: now,
		}
		await prisma.emailCode.createMany({
			data: [
				{ ...emailCode, id: 'expired-email-code', expiresAt: now },
				{
					...emailCode,
					id: 'active-email-code',
					expiresAt: new Date(now.getTime() + 1),
				},
			],
		})
		await prisma.usageEvent.createMany({
			data: [
				{
					id: 'old-usage',
					type: 'maintenance-test',
					userId: user.id,
					createdAt: new Date(startOfDay.getTime() - 1),
				},
				{
					id: 'current-usage',
					type: 'maintenance-test',
					userId: user.id,
					createdAt: startOfDay,
				},
			],
		})
		// Not tied to a user: the demo users they count are deleted hourly.
		await prisma.demoAiUsage.createMany({
			data: [
				{
					id: 'old-demo-ai-use',
					type: 'maintenance-test',
					createdAt: new Date(startOfDay.getTime() - 1),
				},
				{
					id: 'current-demo-ai-use',
					type: 'maintenance-test',
					createdAt: startOfDay,
				},
			],
		})
		await prisma.householdEvent.createMany({
			data: [
				{
					id: 'old-household-event',
					type: 'shopping_list_item_added',
					payload: '{}',
					userId: user.id,
					householdId: household.id,
					createdAt: new Date(eventCutoff.getTime() - 1),
				},
				{
					id: 'retained-household-event',
					type: 'shopping_list_item_added',
					payload: '{}',
					userId: user.id,
					householdId: household.id,
					createdAt: eventCutoff,
				},
			],
		})

		await expect(pruneExpiredData(now)).resolves.toEqual({
			sessions: 1,
			verifications: 1,
			emailCodes: 1,
			usageEvents: 1,
			demoAiUses: 1,
			householdEvents: 1,
		})
		await expect(
			prisma.demoAiUsage.findMany({ select: { id: true } }),
		).resolves.toEqual([{ id: 'current-demo-ai-use' }])
		await expect(
			prisma.session.findMany({ select: { id: true } }),
		).resolves.toEqual([{ id: 'active-session' }])
		await expect(
			prisma.verification.findMany({
				orderBy: { id: 'asc' },
				select: { id: true },
			}),
		).resolves.toEqual([
			{ id: 'active-verification' },
			{ id: 'nonexpiring-verification' },
		])
		await expect(
			prisma.emailCode.findMany({ select: { id: true } }),
		).resolves.toEqual([{ id: 'active-email-code' }])
		await expect(
			prisma.usageEvent.findMany({ select: { id: true } }),
		).resolves.toEqual([{ id: 'current-usage' }])
		await expect(
			prisma.householdEvent.findMany({ select: { id: true } }),
		).resolves.toEqual([{ id: 'retained-household-event' }])
	})
})

describe('startScheduledMaintenance', () => {
	test('contains and reports a failed run, then retries on schedule', async () => {
		vi.useFakeTimers()
		const failure = new Error('database busy')
		const prune = vi
			.fn<() => Promise<MaintenanceSummary>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(EMPTY_SUMMARY)
		const log = vi.fn()
		const logError = vi.fn()
		const reportFailure = vi.fn()

		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			buildDemoTemplate,
			prune,
			pruneImages,
			log,
			logError,
			reportFailure,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining('maintenance: failed error=database busy'),
		)
		expect(reportFailure).toHaveBeenCalledWith(failure)

		await vi.advanceTimersByTimeAsync(1_000)

		expect(prune).toHaveBeenCalledTimes(2)
		expect(log).toHaveBeenCalledWith(
			'🧹 maintenance: sessions=0 verifications=0 email_codes=0 usage_events=0 demo_ai_uses=0 household_events=0 duration_ms=0',
		)
		clearInterval(timer)
	})

	test('does not overlap maintenance runs', async () => {
		vi.useFakeTimers()
		let finishRun: ((summary: MaintenanceSummary) => void) | undefined
		const prune = vi.fn(
			() =>
				new Promise<MaintenanceSummary>((resolve) => {
					finishRun = resolve
				}),
		)
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			buildDemoTemplate,
			prune,
			pruneImages,
			log: vi.fn(),
		})

		await vi.advanceTimersByTimeAsync(2_000)
		expect(prune).toHaveBeenCalledOnce()
		finishRun?.(EMPTY_SUMMARY)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(prune).toHaveBeenCalledTimes(2)
		finishRun?.(EMPTY_SUMMARY)
		clearInterval(timer)
	})

	test('contains a telemetry reporting failure', async () => {
		vi.useFakeTimers()
		const logError = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			buildDemoTemplate,
			prune: vi.fn().mockRejectedValue(new Error('prune failed')),
			pruneImages,
			logError,
			reportFailure: () => {
				throw new Error('telemetry failed')
			},
		})

		await vi.advanceTimersByTimeAsync(0)

		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining('reporting_error=telemetry failed'),
		)
		clearInterval(timer)
	})
	// A full volume is when the cache most needs pruning, and also when the
	// database's own deletes can fail.
	test('prunes the image cache even when the database prune fails', async () => {
		vi.useFakeTimers()
		const prunedImages = vi.fn(async () => ({
			removedFiles: 3,
			removedBytes: 3_000,
			keptBytes: 1_000,
			skipped: 1,
		}))
		const log = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			buildDemoTemplate,
			prune: vi.fn().mockRejectedValue(new Error('disk full')),
			pruneImages: prunedImages,
			log,
			logError: vi.fn(),
			reportFailure: vi.fn(),
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(prunedImages).toHaveBeenCalledOnce()
		expect(log).toHaveBeenCalledWith(
			'🧹 image cache: removed_files=3 removed_bytes=3000 kept_bytes=1000 skipped=1 duration_ms=0',
		)
		clearInterval(timer)
	})

	test('contains and reports a failed image cache prune', async () => {
		vi.useFakeTimers()
		const failure = new Error('cache unreadable')
		const logError = vi.fn()
		const reportFailure = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			buildDemoTemplate,
			prune: async () => EMPTY_SUMMARY,
			pruneImages: vi.fn().mockRejectedValue(failure),
			log: vi.fn(),
			logError,
			reportFailure,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(reportFailure).toHaveBeenCalledWith(failure)
		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining('image cache: failed error=cache unreadable'),
		)
		clearInterval(timer)
	})

	// Without the log, a build that keeps missing photos would go unnoticed.
	test('builds the demo template on every run and logs what it did', async () => {
		vi.useFakeTimers()
		const build = vi.fn(async () => ({
			...CURRENT_TEMPLATE,
			status: 'built' as const,
			missingPhotos: ['greek-salad.webp'],
			abandoned: 1,
		}))
		const log = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			prune: async () => EMPTY_SUMMARY,
			pruneImages,
			buildDemoTemplate: build,
			log,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(log).toHaveBeenCalledWith(
			'🧹 demo template: status=built missing_photos=1 abandoned=1 duration_ms=0',
		)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(build).toHaveBeenCalledTimes(2)
		clearInterval(timer)
	})

	// A failed build must never stop boot or the other steps, and the next
	// hour tries again.
	test('contains and reports a failed demo template build, then retries', async () => {
		vi.useFakeTimers()
		const failure = new Error('storage down')
		const build = vi
			.fn<() => Promise<DemoTemplateSummary>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(CURRENT_TEMPLATE)
		const prune = vi.fn(async () => EMPTY_SUMMARY)
		const logError = vi.fn()
		const reportFailure = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos,
			prune,
			pruneImages,
			buildDemoTemplate: build,
			log: vi.fn(),
			logError,
			reportFailure,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(prune).toHaveBeenCalledOnce()
		expect(reportFailure).toHaveBeenCalledWith(failure)
		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining('demo template: failed error=storage down'),
		)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(build).toHaveBeenCalledTimes(2)
		clearInterval(timer)
	})
})

// A slow build must not hold up expiry, which removes expired demo users' rows
// and photos. The build runs before the other steps so the demo is back
// sooner after a deploy.
test('expires demo users first, then builds the template, then the rest', async () => {
	vi.useFakeTimers()
	const order: string[] = []
	const timer = startScheduledMaintenance({
		intervalMs: 1_000,
		expireDemos: async () => {
			order.push('demo expiry')
			return NO_EXPIRED_DEMOS
		},
		prune: async () => {
			order.push('prune')
			return EMPTY_SUMMARY
		},
		pruneImages: async () => {
			order.push('image cache')
			return EMPTY_IMAGE_CACHE
		},
		buildDemoTemplate: async () => {
			order.push('demo template')
			return CURRENT_TEMPLATE
		},
		log: vi.fn(),
	})
	await vi.advanceTimersByTimeAsync(0)

	expect(order).toEqual([
		'demo expiry',
		'demo template',
		'prune',
		'image cache',
	])
	clearInterval(timer)
})

describe('demo expiry step', () => {
	test('logs how many demo users it deleted and how many failed', async () => {
		vi.useFakeTimers()
		const log = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos: async () => ({ deleted: 3, failed: 1 }),
			buildDemoTemplate,
			prune: async () => EMPTY_SUMMARY,
			pruneImages,
			log,
			logError: vi.fn(),
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(log).toHaveBeenCalledWith(
			'🧹 demo expiry: deleted=3 failed=1 duration_ms=0',
		)
		clearInterval(timer)
	})

	test('logs and reports each demo user it couldn’t delete', async () => {
		vi.useFakeTimers()
		const failure = new Error('database busy')
		const logError = vi.fn()
		const reportFailure = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos: async ({ onFailure }) => {
				onFailure('demo-user-1', failure)
				return { deleted: 2, failed: 1 }
			},
			buildDemoTemplate,
			prune: async () => EMPTY_SUMMARY,
			pruneImages,
			log: vi.fn(),
			logError,
			reportFailure,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(reportFailure).toHaveBeenCalledWith(failure)
		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining(
				'demo expiry: couldn’t delete user=demo-user-1 error=database busy',
			),
		)
		clearInterval(timer)
	})

	test('a failed expiry step still builds the template and runs the rest', async () => {
		vi.useFakeTimers()
		const failure = new Error('disk full')
		const build = vi.fn(buildDemoTemplate)
		const prune = vi.fn(async () => EMPTY_SUMMARY)
		const logError = vi.fn()
		const reportFailure = vi.fn()
		const timer = startScheduledMaintenance({
			intervalMs: 1_000,
			expireDemos: vi.fn().mockRejectedValue(failure),
			buildDemoTemplate: build,
			prune,
			pruneImages,
			log: vi.fn(),
			logError,
			reportFailure,
		})
		await vi.advanceTimersByTimeAsync(0)

		expect(build).toHaveBeenCalledOnce()
		expect(prune).toHaveBeenCalledOnce()
		expect(reportFailure).toHaveBeenCalledWith(failure)
		expect(logError).toHaveBeenCalledWith(
			expect.stringContaining('demo expiry: failed error=disk full'),
		)
		clearInterval(timer)
	})
})
