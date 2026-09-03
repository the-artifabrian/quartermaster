import { afterEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '#app/utils/db.server.ts'
import { createUser } from '#tests/db-utils.ts'
import {
	pruneExpiredData,
	startScheduledMaintenance,
	type MaintenanceSummary,
} from './scheduled-maintenance.ts'

const EMPTY_SUMMARY: MaintenanceSummary = {
	sessions: 0,
	verifications: 0,
	usageEvents: 0,
	householdEvents: 0,
}

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
			usageEvents: 1,
			householdEvents: 1,
		})
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
			prune,
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
			'🧹 maintenance: sessions=0 verifications=0 usage_events=0 household_events=0 duration_ms=0',
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
			prune,
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
			prune: vi.fn().mockRejectedValue(new Error('prune failed')),
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
})
