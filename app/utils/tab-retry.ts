/**
 * Marks a revalidation started by a tab's offline notice. Root's
 * `shouldRevalidate` skips its loader while one runs: root's data is already
 * on the page, and its request has no offline copy, so a retry that fails
 * because the network is not quite back would otherwise replace the whole
 * app with the root error page.
 */
let retrying = false

export async function retryTabOnly(revalidate: () => Promise<void>) {
	retrying = true
	try {
		await revalidate()
	} finally {
		retrying = false
	}
}

export function isTabRetry() {
	return retrying
}
