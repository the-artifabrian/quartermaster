import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useRouteLoaderData } from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'
import {
	formatEventMessage,
	getEventPriority,
} from '#app/utils/household-event-messages.ts'
import { subscribeToHouseholdEvents } from '#app/utils/household-event-source.client.tsx'
import { getRelativeTime } from '#app/utils/relative-time.ts'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuPortal,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'

export function NotificationBell() {
	const rootData = useRouteLoaderData<typeof rootLoader>('root')
	const serverUnreadCount = rootData?.unreadNotificationCount ?? 0
	const [clientIncrements, setClientIncrements] = useState(0)
	const [cleared, setCleared] = useState(false)
	const unreadCount = cleared
		? clientIncrements
		: serverUnreadCount + clientIncrements

	const loadFetcher = useFetcher<{
		notifications: Array<{
			id: string
			type: string
			payload: string
			createdAt: string
			user: { name: string | null; username: string }
		}>
		lastSeenAt: string | null
	}>()
	const markReadFetcher = useFetcher()

	const hasLoadedRef = useRef(false)
	const prevServerCount = useRef(serverUnreadCount)

	// Reset cleared flag when root loader revalidates with a fresh count
	if (prevServerCount.current !== serverUnreadCount) {
		prevServerCount.current = serverUnreadCount
		setCleared(false)
		setClientIncrements(0)
	}

	// Subscribe to SSE events and increment client counter (notify-tier only)
	useEffect(() => {
		const unsubscribe = subscribeToHouseholdEvents((event) => {
			if (getEventPriority(event.type) === 'notify') {
				setClientIncrements((prev) => prev + 1)
			}
		})
		return unsubscribe
	}, [])

	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (open) {
				void loadFetcher.load('/resources/notifications')
				if (unreadCount > 0) {
					void markReadFetcher.submit(null, {
						method: 'POST',
						action: '/resources/notifications',
					})
					setCleared(true)
					setClientIncrements(0)
				}
				hasLoadedRef.current = true
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[unreadCount],
	)

	const notifications = loadFetcher.data?.notifications ?? []
	const lastSeenAt = loadFetcher.data?.lastSeenAt

	return (
		<DropdownMenu modal={false} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					className="text-muted-foreground hover:text-foreground relative inline-flex items-center justify-center p-2.5 transition-colors"
					aria-label={
						unreadCount > 0
							? `Notifications (${unreadCount} unread)`
							: 'Notifications'
					}
				>
					<Icon name="bell" className="size-5" />
					{unreadCount > 0 ? (
						<span className="bg-accent text-accent-foreground absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none">
							{unreadCount > 99 ? '99+' : unreadCount}
						</span>
					) : null}
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent
					sideOffset={8}
					align="end"
					className="w-80 max-h-96 overflow-y-auto rounded-xl shadow-warm-lg p-0"
				>
					<div className="border-b px-3 py-2">
						<h3 className="text-sm font-semibold">Notifications</h3>
					</div>
					{loadFetcher.state === 'loading' && !hasLoadedRef.current ? (
						<div className="text-muted-foreground px-3 py-6 text-center text-sm">
							Loading...
						</div>
					) : notifications.length === 0 ? (
						<div className="text-muted-foreground px-3 py-6 text-center text-sm">
							No notifications yet
						</div>
					) : (
						<ul className="flex flex-col">
							{notifications.map((notification) => {
								const payload = JSON.parse(
									notification.payload,
								) as Record<string, unknown>
								const username =
									notification.user.name ??
									notification.user.username
								const { message, url } = formatEventMessage(
									notification.type,
									payload,
									username,
								)
								const createdAt = new Date(
									notification.createdAt,
								)
								const isUnread =
									getEventPriority(notification.type) ===
										'notify' &&
									lastSeenAt &&
									new Date(notification.createdAt) >
										new Date(lastSeenAt)
								const timeAgo = getRelativeTime(createdAt)

								const content = (
									<div
										className={`flex items-baseline justify-between gap-2 px-3 py-2 text-sm ${
											isUnread ? 'bg-accent/5' : ''
										}`}
									>
										<span className="text-foreground min-w-0 flex-1">
											{message}
										</span>
										<span className="text-muted-foreground shrink-0 text-xs">
											{timeAgo}
										</span>
									</div>
								)

								return (
									<li key={notification.id}>
										{url ? (
											<Link
												to={url}
												className="hover:bg-accent block transition-colors"
											>
												{content}
											</Link>
										) : (
											content
										)}
									</li>
								)
							})}
						</ul>
					)}
					<div className="border-t px-3 py-2 text-center">
						<Link
							to="/settings/profile/household"
							className="text-muted-foreground hover:text-foreground text-xs transition-colors"
						>
							View all activity
						</Link>
					</div>
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}
