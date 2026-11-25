// Runs a callback once each time a fetcher's submit or load comes back.
import { useEffect, useEffectEvent, useRef } from 'react'

/**
 * Calls `onSettled` with the fetcher's data when it goes from submitting or
 * loading back to idle, after any revalidation the submit started. It never
 * calls on mount, so a keyed fetcher that already holds an answer from an
 * earlier submit stays quiet. The callback from the latest render runs, so it
 * can read current state without being a dependency.
 */
export function useFetcherSettled<Data>(
	fetcher: { state: 'idle' | 'loading' | 'submitting'; data: Data },
	onSettled: (data: Data) => void,
) {
	const previousState = useRef(fetcher.state)
	const settled = useEffectEvent(onSettled)
	useEffect(() => {
		const wasBusy = previousState.current !== 'idle'
		previousState.current = fetcher.state
		if (wasBusy && fetcher.state === 'idle') settled(fetcher.data)
	}, [fetcher.state, fetcher.data])
}
