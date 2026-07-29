import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
	formatEventBatch,
	type FormattedEvent,
} from '#app/utils/household-event-messages.ts'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'

// Events that land together — a catch-up poll on resume returns up to 50, and
// a reconnect replays the gap — are collected over this window and toasted as
// one batch, so a resume can't drip 50 toasts over the content.
const BATCH_WINDOW_MS = 300

export function HouseholdActivityNotifier() {
	const navigate = useNavigate()

	useEffect(() => {
		let pending: Array<FormattedEvent> = []
		let flushTimer: ReturnType<typeof setTimeout> | null = null

		function flush() {
			flushTimer = null
			const batch = pending
			pending = []
			for (const { message, url } of formatEventBatch(batch)) {
				toast(message, {
					action: url
						? {
								label: 'View',
								onClick: () => navigate(url),
							}
						: undefined,
				})
			}
		}

		const unsubscribe = subscribeToHouseholdEvents((event) => {
			pending.push({
				type: event.type,
				payload: event.payload,
				username: event.username,
			})
			flushTimer ??= setTimeout(flush, BATCH_WINDOW_MS)
		})

		return () => {
			unsubscribe()
			if (flushTimer) clearTimeout(flushTimer)
		}
	}, [navigate])

	return null
}
