import { invariant } from '@epic-web/invariant'
import { useRouteLoaderData } from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'

/**
 * @returns the request info from the root loader (throws an error if it does not exist)
 */
export function useRequestInfo() {
	const maybeRequestInfo = useOptionalRequestInfo()
	invariant(maybeRequestInfo, 'No requestInfo found in root loader')

	return maybeRequestInfo
}

export function useOptionalRequestInfo() {
	const data = useRouteLoaderData<typeof rootLoader>('root')

	return data?.requestInfo
}

/**
 * True when the page is running inside the iOS app's shell. The root loader
 * reads the shell's user-agent token; see `native-shell.server.ts`.
 */
export function useIsNativeShell() {
	return useOptionalRequestInfo()?.isNativeShell ?? false
}
