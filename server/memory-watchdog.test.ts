import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	breachReason,
	createBreachTracker,
	parseMemAvailableMb,
	parseProcStatus,
	startMemoryWatchdog,
	type MemorySample,
} from './memory-watchdog.ts'

// Trimmed from a real Fly machine (shared-cpu-1x/512MB) during the 2026-07-28
// incident: MemAvailable 31MB, bun at 373MB RSS + 265MB swapped.
const MEMINFO_THRASHING = `MemTotal:         489372 kB
MemFree:           12256 kB
MemAvailable:      31744 kB
Buffers:            1204 kB
Cached:            48212 kB
SwapTotal:        524284 kB
SwapFree:         252916 kB
`

const STATUS_THRASHING = `Name:	bun
Umask:	0022
State:	S (sleeping)
VmPeak:	 1204480 kB
VmSize:	 1104896 kB
VmRSS:	  381952 kB
VmSwap:	  271360 kB
Threads:	12
`

const MEMINFO_HEALTHY = `MemTotal:         489372 kB
MemFree:           98304 kB
MemAvailable:     194969 kB
SwapTotal:        524284 kB
SwapFree:         524284 kB
`

const STATUS_HEALTHY = `Name:	bun
VmRSS:	  245760 kB
VmSwap:	       0 kB
`

const CONFIG = { intervalMs: 30_000, minAvailableMb: 50, maxSwapMb: 250 }

describe('proc parsing', () => {
	test('extracts MemAvailable in MB', () => {
		expect(parseMemAvailableMb(MEMINFO_THRASHING)).toBe(31)
		expect(parseMemAvailableMb(MEMINFO_HEALTHY)).toBe(190)
	})

	test('extracts VmRSS and VmSwap in MB', () => {
		expect(parseProcStatus(STATUS_THRASHING)).toEqual({
			vmRssMb: 373,
			vmSwapMb: 265,
		})
		expect(parseProcStatus(STATUS_HEALTHY)).toEqual({
			vmRssMb: 240,
			vmSwapMb: 0,
		})
	})

	test('returns null for missing fields instead of guessing', () => {
		expect(parseMemAvailableMb('MemTotal: 489372 kB\n')).toBeNull()
		expect(parseProcStatus('Name:\tbun\n')).toEqual({
			vmRssMb: null,
			vmSwapMb: null,
		})
		// A prefix must not match (MemAvailable vs Mem)
		expect(parseMemAvailableMb('MemAvailableX: 1024 kB\n')).toBeNull()
	})
})

describe('breachReason', () => {
	test('flags the incident-day sample on both conditions', () => {
		expect(
			breachReason({ memAvailableMb: 31, vmSwapMb: 265, vmRssMb: 373 }, CONFIG),
		).toContain('MemAvailable 31MB')
		// Swap alone (thrash not yet started) still breaches
		expect(
			breachReason(
				{ memAvailableMb: 120, vmSwapMb: 265, vmRssMb: 373 },
				CONFIG,
			),
		).toContain('VmSwap 265MB')
	})

	test('healthy sample and exact thresholds pass', () => {
		expect(
			breachReason({ memAvailableMb: 190, vmSwapMb: 0, vmRssMb: 240 }, CONFIG),
		).toBeNull()
		expect(
			breachReason({ memAvailableMb: 50, vmSwapMb: 250, vmRssMb: 300 }, CONFIG),
		).toBeNull()
	})

	test('unreadable fields never breach — a broken /proc read must not kill the process', () => {
		expect(
			breachReason(
				{ memAvailableMb: null, vmSwapMb: null, vmRssMb: null },
				CONFIG,
			),
		).toBeNull()
	})
})

describe('createBreachTracker', () => {
	test('requires consecutive breaches and resets on any healthy sample', () => {
		const tracker = createBreachTracker(3)
		expect(tracker.record('breach').shouldExit).toBe(false)
		expect(tracker.record('breach').shouldExit).toBe(false)
		// Healthy sample resets the streak — a transient spike never exits
		expect(tracker.record(null).shouldExit).toBe(false)
		expect(tracker.record('breach').shouldExit).toBe(false)
		expect(tracker.record('breach').shouldExit).toBe(false)
		expect(tracker.record('breach')).toEqual({ shouldExit: true, count: 3 })
	})
})

describe('startMemoryWatchdog', () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	const HEALTHY: MemorySample = {
		memAvailableMb: 190,
		vmSwapMb: 0,
		vmRssMb: 240,
	}
	const BREACHING: MemorySample = {
		memAvailableMb: 31,
		vmSwapMb: 265,
		vmRssMb: 373,
	}

	test('forces a GC on breach and only exits when the breach survives it', async () => {
		vi.useFakeTimers()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})

		// 'collectable' pressure re-accumulates every tick but a forced GC clears
		// it; a 'rooted' leak survives GC (the zombie-SSE failure mode).
		let mode: 'healthy' | 'collectable' | 'rooted' = 'healthy'
		let gcJustRan = false
		const gc = vi.fn(() => {
			if (mode === 'collectable') gcJustRan = true
		})
		const readSample = (): MemorySample => {
			if (mode === 'healthy') return HEALTHY
			if (gcJustRan) {
				gcJustRan = false
				return HEALTHY
			}
			return BREACHING
		}
		const fatal = vi.fn()
		const timer = startMemoryWatchdog({ gc, readSample, fatal })
		expect(timer).not.toBeNull()

		// 10 grace samples + 2 healthy ones: no GC, no exit.
		await vi.advanceTimersByTimeAsync(12 * 30_000)
		expect(gc).not.toHaveBeenCalled()

		// Collectable pressure: every breach is fixed by the forced GC.
		mode = 'collectable'
		await vi.advanceTimersByTimeAsync(5 * 30_000)
		expect(gc).toHaveBeenCalledTimes(5)
		expect(fatal).not.toHaveBeenCalled()

		// Rooted leak: GC no longer helps → exit on the 3rd consecutive breach.
		mode = 'rooted'
		await vi.advanceTimersByTimeAsync(2 * 30_000)
		expect(fatal).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(30_000)
		expect(fatal).toHaveBeenCalledTimes(1)
		expect(fatal.mock.calls[0]?.[0]).toContain('MemAvailable 31MB')

		// The timer cleared itself — no further samples after the exit call.
		await vi.advanceTimersByTimeAsync(5 * 30_000)
		expect(fatal).toHaveBeenCalledTimes(1)
	})

	test('flushes telemetry before the fatal path exits', async () => {
		vi.useFakeTimers()
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'warn').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const flushTelemetry = vi.fn().mockResolvedValue(undefined)
		const exit = vi.fn()

		startMemoryWatchdog({
			readSample: () => BREACHING,
			flushTelemetry,
			exit,
		})
		await vi.advanceTimersByTimeAsync(13 * 30_000)

		expect(flushTelemetry).toHaveBeenCalledOnce()
		expect(exit).toHaveBeenCalledWith(1)
		expect(flushTelemetry.mock.invocationCallOrder[0]).toBeLessThan(
			exit.mock.invocationCallOrder[0]!,
		)
	})
})
