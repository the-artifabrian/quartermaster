/**
 * Marks a revalidation started by a tab's offline notice. Root's
 * `shouldRevalidate` skips its loader for that same-URL revalidation: root's data is already
 * on the page, and its request has no offline copy, so a retry that fails
 * because the network is not quite back would otherwise replace the whole
 * app with the root error page.
 */
// A count, so a tap during the automatic retries keeps both marked.
let retrying = 0

export async function retryTabOnly(revalidate: () => Promise<void>) {
	retrying++
	try {
		await revalidate()
	} finally {
		retrying--
	}
}

/** True while a retry runs; root checks it for same-URL revalidations only. */
export function isTabRetry() {
	return retrying > 0
}
