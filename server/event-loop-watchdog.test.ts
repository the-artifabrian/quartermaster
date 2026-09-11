import { describe, expect, test, vi } from 'vitest'
import {
	checksFor,
	evaluateHeartbeat,
	initialHeartbeatState,
	readEventLoopWatchdogConfig,
	startEventLoopWatchdog,
	type EventLoopWatchdogConfig,
} from './event-loop-watchdog.ts'

const config: EventLoopWatchdogConfig = {
	heartbeatIntervalMs: 1_000,
	checkIntervalMs: 5_000,
	stallThresholdMs: 60_000,
	graceMs: 60_000,
}

/** Drive the policy through a series of counter readings. */
function run(counts: number[], cfg: EventLoopWatchdogConfig = config) {
	let state = initialHeartbeatState()
	const reasons: Array<string | null> = []
	for (const count of counts) {
		const result = evaluateHeartbeat(state, count, cfg)
		state = result.state
		reasons.push(result.reason)
	}
	return reasons
}

/** A counter that advances on every check — a healthy loop. */
function advancing(n: number, from = 1) {
	return Array.from({ length: n }, (_, i) => from + i)
}

describe('evaluateHeartbeat', () => {
	test('a counter that keeps advancing never stalls', () => {
		expect(run(advancing(200)).every((r) => r === null)).toBe(true)
	})

	test('a frozen counter stalls once past the threshold', () => {
		const { graceChecks, stallChecks } = checksFor(config)
		// Healthy through the grace window, then frozen at the same value.
		// stallChecks + 1 frozen readings: the first one still shows progress
		// relative to the last advancing value, so it does not count.
		const counts = [
			...advancing(graceChecks),
			...Array(stallChecks + 1).fill(999),
		]
		const reasons = run(counts)

		expect(reasons.slice(0, -1).every((r) => r === null)).toBe(true)
		expect(reasons.at(-1)).toBe(
			'event loop made no progress for 60s across 12 checks (threshold 60s)',
		)
	})

	test('nothing stalls during the boot grace, however frozen', () => {
		// Migrations and LiteFS sync can block the loop well past the threshold
		// before the server is serving; that must never count.
		const { graceChecks } = checksFor(config)
		expect(run(Array(graceChecks).fill(0)).every((r) => r === null)).toBe(true)
	})

	test('a single no-progress observation is never enough', () => {
		// The worker may look between two heartbeats; one flat reading proves
		// nothing. Verified even with a threshold below one check interval.
		const twitchy = { ...config, stallThresholdMs: 1, graceMs: 0 }
		expect(checksFor(twitchy).stallChecks).toBe(2)
		expect(run([5, 5], twitchy)).toEqual([null, null])
		expect(run([5, 5, 5], twitchy)).toEqual([null, null, expect.any(String)])
	})

	test('progress resets the stall counter', () => {
		const { graceChecks, stallChecks } = checksFor(config)
		const counts = [
			...advancing(graceChecks),
			// Frozen for one check short of the threshold, then it moves again.
			...Array(stallChecks - 1).fill(999),
			1000,
			...Array(stallChecks - 1).fill(1000),
		]
		expect(run(counts).every((r) => r === null)).toBe(true)
	})

	test('a wall-clock jump cannot fake a stall', () => {
		// The reason this policy counts progress instead of comparing
		// timestamps: an NTP step larger than the stall threshold used to look
		// exactly like a wedged loop, and the response to that is SIGKILL.
		// Counter readings are unaffected by any clock change.
		const { graceChecks } = checksFor(config)
		const counts = [...advancing(graceChecks), ...advancing(50, 10_000)]
		expect(run(counts).every((r) => r === null)).toBe(true)
	})

	test('the 2026-09-11 outage shape is caught in about a minute', () => {
		const { graceChecks, stallChecks } = checksFor(config)
		const counts = [...advancing(graceChecks), ...Array(200).fill(4242)]
		const reasons = run(counts)
		const firstStall = reasons.findIndex((r) => r !== null)

		// The reading at index graceChecks still shows progress (it is the first
		// frozen value, compared against the last advancing one); stallChecks
		// no-progress readings follow it.
		expect(firstStall - graceChecks).toBe(stallChecks)
		expect((stallChecks * config.checkIntervalMs) / 1000).toBe(60)
	})
})

describe('checksFor', () => {
	test('converts the millisecond thresholds into whole checks', () => {
		expect(checksFor(config)).toEqual({ stallChecks: 12, graceChecks: 12 })
	})

	test('rounds a partial check up rather than acting early', () => {
		expect(checksFor({ ...config, stallThresholdMs: 61_000 }).stallChecks).toBe(
			13,
		)
	})
})

describe('startEventLoopWatchdog', () => {
	test('the kill switch stops it starting', () => {
		const messages: string[] = []
		const previous = process.env.EVENT_LOOP_WATCHDOG_ENABLED
		process.env.EVENT_LOOP_WATCHDOG_ENABLED = 'false'
		try {
			expect(
				startEventLoopWatchdog({ config, log: (m) => messages.push(m) }),
			).toBeNull()
			expect(messages.join()).toContain('disabled')
		} finally {
			if (previous === undefined) delete process.env.EVENT_LOOP_WATCHDOG_ENABLED
			else process.env.EVENT_LOOP_WATCHDOG_ENABLED = previous
		}
	})

	test('an interval of 0 disables it, like the sibling watchdogs', () => {
		const messages: string[] = []
		expect(
			startEventLoopWatchdog({
				config: { ...config, checkIntervalMs: 0 },
				log: (m) => messages.push(m),
			}),
		).toBeNull()
		expect(messages.join()).toContain('disabled')
	})
})

describe('readEventLoopWatchdogConfig', () => {
	test('an unusable value falls back instead of disabling the mitigation', () => {
		const previous = process.env.EVENT_LOOP_WATCHDOG_STALL_MS
		process.env.EVENT_LOOP_WATCHDOG_STALL_MS = 'not-a-number'
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			expect(readEventLoopWatchdogConfig().stallThresholdMs).toBe(60_000)
		} finally {
			if (previous === undefined)
				delete process.env.EVENT_LOOP_WATCHDOG_STALL_MS
			else process.env.EVENT_LOOP_WATCHDOG_STALL_MS = previous
			vi.restoreAllMocks()
		}
	})

	test('0 is honoured as "disabled", not treated as invalid', () => {
		const previous = process.env.EVENT_LOOP_WATCHDOG_CHECK_MS
		process.env.EVENT_LOOP_WATCHDOG_CHECK_MS = '0'
		try {
			expect(readEventLoopWatchdogConfig().checkIntervalMs).toBe(0)
		} finally {
			if (previous === undefined)
				delete process.env.EVENT_LOOP_WATCHDOG_CHECK_MS
			else process.env.EVENT_LOOP_WATCHDOG_CHECK_MS = previous
		}
	})
})
