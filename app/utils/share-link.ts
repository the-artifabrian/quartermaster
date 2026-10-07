export type ShareLinkData = { title: string; url: string }

export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'copy-failed'

/**
 * Opens the system share sheet when the browser has one, and copies the link
 * otherwise. The browser functions come in as parameters so the decision can
 * be tested without touching `navigator`; leave `share` or `canShare` out when
 * the browser lacks them. A cancelled sheet is silent. Any other share failure
 * still leaves the person with the link by copying it.
 */
export async function shareOrCopy({
	data,
	share,
	canShare,
	copy,
}: {
	data: ShareLinkData
	share?: (data: ShareLinkData) => Promise<void>
	canShare?: (data: ShareLinkData) => boolean
	copy: (text: string) => Promise<void>
}): Promise<ShareOutcome> {
	if (share && (!canShare || canShare(data))) {
		try {
			await share(data)
			return 'shared'
		} catch (error) {
			if (isAbort(error)) return 'cancelled'
		}
	}
	try {
		await copy(data.url)
		return 'copied'
	} catch {
		return 'copy-failed'
	}
}

function isAbort(error: unknown) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		error.name === 'AbortError'
	)
}
