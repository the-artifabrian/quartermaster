import { useEffect, useRef } from 'react'
import { useRevalidator } from 'react-router'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'

const SHOPPING_EVENT_TYPES = new Set([
	'shopping_list_generated',
	'shopping_list_item_added',
	'shopping_list_cleared',
	'shopping_list_to_inventory',
	'shopping_list_item_toggled',
	'shopping_list_item_edited',
	'shopping_list_item_deleted',
])

export function ShoppingListLiveRefresh() {
	const { revalidate } = useRevalidator()
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		const unsubscribe = subscribeToHouseholdEvents((event) => {
			if (!SHOPPING_EVENT_TYPES.has(event.type)) return
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(() => {
				debounceRef.current = null
				void revalidate()
			}, 500)
		})

		return () => {
			unsubscribe()
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [revalidate])

	return null
}
