import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
	formatEventMessage,
	getEventPriority,
} from '#app/utils/household-event-messages.ts'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'

export function HouseholdActivityNotifier() {
	const navigate = useNavigate()

	useEffect(() => {
		const unsubscribe = subscribeToHouseholdEvents((event) => {
			if (getEventPriority(event.type) !== 'notify') return

			const { message, url } = formatEventMessage(
				event.type,
				event.payload,
				event.username,
			)

			toast(message, {
				action: url
					? {
							label: 'View',
							onClick: () => navigate(url),
						}
					: undefined,
			})
		})

		return unsubscribe
	}, [navigate])

	return null
}
