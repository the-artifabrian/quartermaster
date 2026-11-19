import {
	isRouteErrorResponse,
	replace,
	type DataStrategyResult,
	type MiddlewareFunction,
	useRouteError,
} from 'react-router'
import { isHistoryTraversalTo } from '#app/utils/nav-direction.ts'
import { useNonce } from '#app/utils/nonce-provider.ts'
import { OfflineErrorBoundary } from './offline-error-boundary.tsx'

// A Recipe or Menu deleted here or by another member can still have entries
// in the history: behind a list a Delete returned to through another tab,
// from before a reload, or from a link loop. Going back to one opens its list
// in that entry's place instead of a not-found page. A link or a deep link to
// a missing Recipe or Menu still says it is not found.

function isNotFound(result: DataStrategyResult) {
	return (
		result.type === 'error' &&
		isRouteErrorResponse(result.result) &&
		result.result.status === 404
	)
}

/**
 * Client middleware for a Recipe's or Menu's pages: a history traversal that
 * finds the item gone opens `list` in its entry's place, before anything of
 * the not-found page renders.
 */
export function goneItemMiddleware(
	list: string,
): MiddlewareFunction<Record<string, DataStrategyResult>> {
	return async ({ request }, next) => {
		const results = await next()
		if (request.method !== 'GET') return results
		if (!isHistoryTraversalTo(new URL(request.url))) return results
		if (Object.values(results).some(isNotFound)) throw replace(list)
		return results
	}
}

/**
 * The same for a traversal that loads a new document (an entry from before a
 * reload, or after the iOS app's web view restarted): the server's not-found
 * page stops before its message is parsed and opens the list in its place.
 * The browser says how the document was reached; the server cannot tell a
 * back from a link.
 */
function leaveGoneDocumentScript(list: string) {
	return `(function(){var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];if(n&&n.type==='back_forward'){window.stop();location.replace(${JSON.stringify(list)})}})()`
}

export function GoneItemBoundary({ list }: { list: string }) {
	const error = useRouteError()
	const nonce = useNonce()
	const gone = isRouteErrorResponse(error) && error.status === 404
	return (
		<>
			{gone ? (
				<script
					nonce={nonce}
					dangerouslySetInnerHTML={{ __html: leaveGoneDocumentScript(list) }}
				/>
			) : null}
			<OfflineErrorBoundary />
		</>
	)
}
