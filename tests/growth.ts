/**
 * Timing that holds on a slow runner or under coverage: a case times the same
 * input at one size and at four times that size. Linear work takes about four
 * times as long, while quadratic work takes about sixteen, so the ratio tells
 * them apart where a fixed time limit would not.
 */

// Linear work grows about 4× from one size to the next, quadratic about 16×.
export const MAX_GROWTH = 8
// Only a backstop: a hang still fails here rather than at the test timeout.
export const BACKSTOP_MS = 1000

function elapsedMs(run: () => unknown, times: number) {
	const start = performance.now()
	for (let i = 0; i < times; i++) run()
	return performance.now() - start
}

/** The best of five, so a pause for garbage collection doesn't count. */
export function bestMs(run: () => unknown, times: number) {
	let best = Infinity
	for (let i = 0; i < 5; i++) best = Math.min(best, elapsedMs(run, times))
	return best
}

/**
 * How much longer the input at four times the size takes. Each side repeats
 * its run enough times to take a few milliseconds, so timer resolution
 * doesn't decide the ratio.
 */
export function growth(build: (size: number) => () => unknown) {
	const small = build(1)
	const large = build(4)
	small()
	large()
	let times = 1
	while (elapsedMs(small, times) < 5 && times < 1 << 16) times *= 2
	return {
		ratio: bestMs(large, times) / bestMs(small, times),
		largeMs: elapsedMs(large, 1),
	}
}
