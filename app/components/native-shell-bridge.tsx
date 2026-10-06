import { useEffect, useRef } from 'react'
import { useRevalidator } from 'react-router'
import { connectShellRefresh, postTheme } from '#app/utils/shell-bridge.ts'

/**
 * Root-level consumers of the iOS shell bridge, rendered only in the iOS app:
 * reports the theme for the status bar style, and answers pull to refresh by
 * revalidating the page's loaders.
 */
export function NativeShellBridge({ theme }: { theme: 'light' | 'dark' }) {
	const revalidator = useRevalidator()
	const revalidatorRef = useRef(revalidator)
	revalidatorRef.current = revalidator

	useEffect(() => {
		postTheme(theme)
	}, [theme])

	useEffect(() => connectShellRefresh(() => revalidatorRef.current), [])

	return null
}
