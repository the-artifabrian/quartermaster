import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'

export function useShoppingActivityDot(enabled: boolean): boolean {
	const [hasActivity, setHasActivity] = useState(false)
	const location = useLocation()
	const isOnShopping = location.pathname.startsWith('/shopping')

	// Clear the dot when navigating to the shopping page
	useEffect(() => {
		if (isOnShopping) {
			setHasActivity(false)
		}
	}, [isOnShopping])

	// Subscribe to household events and listen for shopping events
	useEffect(() => {
		if (!enabled) return

		const unsubscribe = subscribeToHouseholdEvents((event) => {
			if (event.type.startsWith('shopping_list_')) {
				setHasActivity(true)
			}
		})

		return unsubscribe
	}, [enabled])

	// Don't show the dot if we're already on the shopping page
	return hasActivity && !isOnShopping
}
