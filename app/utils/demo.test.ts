// Failure list for the demo banner's countdown. The root loader sends the time
// left by the server's clock (`demoMsLeft`); the page counts down from it with
// the browser's clock.
// - the browser's clock is hours ahead of or behind the server's: the time
//   left still follows the server, because only time passed on the browser
//   counts, never the browser's own date
// - the tab sleeps and its timers stop, then wakes 50 minutes later: the next
//   reading has lost those 50 minutes, because it measures the time passed
//   rather than counting ticks
// - the browser's clock is set back while the page is open: the time left
//   never grows past what the server said
// - the time runs out with the page open: zero and below read as ended,
//   never "0 min" or a negative number
// - under a minute left: it reads "1 min" until it ends (rounded up)
// - whole hours read without minutes, and hours and minutes balance
import { expect, test } from 'vitest'
import {
	demoMsLeftNow,
	demoTimeLeftLabel,
	demoTimeLeftIso,
	DEMO_LIFETIME_MS,
} from './demo.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

test('a browser clock hours off the server still counts down from the server’s time left', () => {
	const msLeftAtLoad = 100 * MINUTE
	for (const skew of [-5 * HOUR, 0, 3 * HOUR]) {
		const loadedAt = Date.UTC(2026, 10, 24, 12) + skew
		expect(
			demoMsLeftNow({ msLeftAtLoad, loadedAt, now: loadedAt + 10 * MINUTE }),
		).toBe(90 * MINUTE)
	}
})

test('after the tab sleeps, the next reading has lost the time it slept', () => {
	const loadedAt = 1_000_000
	expect(
		demoMsLeftNow({
			msLeftAtLoad: DEMO_LIFETIME_MS,
			loadedAt,
			now: loadedAt + 50 * MINUTE,
		}),
	).toBe(DEMO_LIFETIME_MS - 50 * MINUTE)
})

test('a browser clock set back never adds time', () => {
	const loadedAt = 1_000_000
	expect(
		demoMsLeftNow({
			msLeftAtLoad: 30 * MINUTE,
			loadedAt,
			now: loadedAt - 2 * HOUR,
		}),
	).toBe(30 * MINUTE)
})

test('zero and past it read as ended', () => {
	expect(demoTimeLeftLabel(0)).toBeNull()
	expect(demoTimeLeftLabel(-5 * MINUTE)).toBeNull()
	expect(demoTimeLeftIso(0)).toBeNull()
})

test('under a minute reads as a minute until it ends', () => {
	expect(demoTimeLeftLabel(1)).toBe('1 min')
	expect(demoTimeLeftLabel(59 * 1000)).toBe('1 min')
	expect(demoTimeLeftIso(59 * 1000)).toBe('PT1M')
})

test('hours and minutes read the way Recipe times do', () => {
	expect(demoTimeLeftLabel(2 * HOUR)).toBe('2 hr')
	expect(demoTimeLeftLabel(100 * MINUTE)).toBe('1 hr 40 min')
	// 1 h 39 min and a second is still within the 40th minute.
	expect(demoTimeLeftLabel(99 * MINUTE + 1000)).toBe('1 hr 40 min')
	expect(demoTimeLeftLabel(59 * MINUTE + 1)).toBe('1 hr')
	expect(demoTimeLeftLabel(45 * MINUTE)).toBe('45 min')
	expect(demoTimeLeftIso(100 * MINUTE)).toBe('PT1H40M')
	expect(demoTimeLeftIso(2 * HOUR)).toBe('PT2H')
})
