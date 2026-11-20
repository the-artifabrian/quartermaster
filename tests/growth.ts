/**
 * Timing that holds on a slow or busy runner, or under coverage: a case times
 * the same input at one size and at SPREAD times that size. Linear work takes
 * about 16 times as long, while quadratic work takes about 256 times, so a
 * limit of 64 sits far from both. Load on the machine can stretch either
 * side by a few times without crossing it, which a fixed time limit, or a
 * smaller spread, can't promise.
 */

/** How many times larger the second input is than the first. */
export const SPREAD = 16
// Linear work grows about 16× from one size to the next, quadratic about 256×.
export const MAX_GROWTH = 64
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
 * How much longer the input at SPREAD times the size takes. Both sides run
 * once first to warm up. Each side then repeats its run enough times to take
 * a few milliseconds, so timer resolution doesn't decide the ratio, and the
 * best of five counts. The backstop applies to a warmed-up run. A large
 * input whose warm-up run takes five times the backstop isn't timed again,
 * so a regression fails fast instead of running for minutes.
 */
export function growth(build: (size: number) => () => unknown) {
	const small = build(1)
	const large = build(SPREAD)
	small()
	// A warm-up run this slow is already a failure; skip the timed runs.
	if (elapsedMs(large, 1) >= 5 * BACKSTOP_MS) {
		return { ratio: Infinity, largeMs: Infinity }
	}
	const largeMs = elapsedMs(large, 1)
	let times = 1
	while (elapsedMs(small, times) < 5 && times < 1 << 16) times *= 2
	return {
		ratio: bestMs(large, times) / bestMs(small, times),
		largeMs,
	}
}
