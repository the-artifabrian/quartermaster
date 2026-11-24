/**
 * How many times looser rate limits are: 1 in production, and so loose they
 * never trip in development and under Playwright, whose fast tests all come
 * from one address. Playwright sets PLAYWRIGHT_TEST_BASE_URL for the server
 * it starts.
 */
export function rateLimitMultiple(
	env: Record<string, string | undefined> = process.env,
) {
	return env.NODE_ENV !== 'production' || env.PLAYWRIGHT_TEST_BASE_URL
		? 10_000
		: 1
}
