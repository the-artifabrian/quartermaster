import { OpenImgContextProvider } from 'openimg/react'
import {
	data,
	Link,
	Links,
	Meta,
	NavLink,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from 'react-router'
import { type Route } from './+types/root.ts'
import appleTouchIconAssetUrl from './assets/favicons/apple-touch-icon.png'
import faviconAssetUrl from './assets/favicons/favicon.svg'
import { BottomNav } from './components/bottom-nav.tsx'
import { GeneralErrorBoundary } from './components/error-boundary.tsx'
import { HouseholdActivityNotifier } from './components/household-activity-notifier.tsx'
import { NotificationBell } from './components/notification-bell.tsx'
import { OfflineIndicator } from './components/offline-indicator.tsx'
import { Progress } from './components/progress-bar.tsx'
import { TimerWidget } from './components/timer-widget.tsx'
import { useToast } from './components/toaster.tsx'
import { Button } from './components/ui/button.tsx'
import { Icon, href as iconsHref } from './components/ui/icon.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { UserDropdown } from './components/user-dropdown.tsx'
import {
	useOptionalTheme,
	useTheme,
} from './routes/resources/theme-switch.tsx'
import tailwindStyleSheetUrl from './styles/tailwind.css?url'
import { getUserId, logout } from './utils/auth.server.ts'
import { ClientHintCheck, getHints } from './utils/client-hints.tsx'
import { prisma } from './utils/db.server.ts'
import { getEnv } from './utils/env.server.ts'
import { pipeHeaders } from './utils/headers.server.ts'
import { NOTIFY_EVENT_TYPES_LIST } from './utils/household-event-messages.ts'
import { combineHeaders, getDomainUrl, getImgSrc } from './utils/misc.tsx'
import { useNonce } from './utils/nonce-provider.ts'
import { type Theme, getTheme } from './utils/theme.server.ts'
import { TimerProvider } from './utils/timer-context.tsx'
import { makeTimings, time } from './utils/timing.server.ts'
import { getToast } from './utils/toast.server.ts'
import { getUserTier, type TierInfo } from './utils/subscription.server.ts'
import { useOptionalUser } from './utils/user.ts'

export const links: Route.LinksFunction = () => {
	return [
		// Preload svg sprite as a resource to avoid render blocking
		{ rel: 'preload', href: iconsHref, as: 'image' },
		// Google Fonts
		{ rel: 'preconnect', href: 'https://fonts.googleapis.com' },
		{
			rel: 'preconnect',
			href: 'https://fonts.gstatic.com',
			crossOrigin: 'anonymous',
		} as const,
		{
			rel: 'stylesheet',
			href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..700&display=swap',
		},
		{
			rel: 'icon',
			href: '/favicon.ico',
			sizes: '48x48',
		},
		{ rel: 'icon', type: 'image/svg+xml', href: faviconAssetUrl },
		{ rel: 'apple-touch-icon', href: appleTouchIconAssetUrl },
		{
			rel: 'manifest',
			href: '/site.webmanifest',
			crossOrigin: 'use-credentials',
		} as const, // necessary to make typescript happy
		{ rel: 'stylesheet', href: tailwindStyleSheetUrl },
	].filter(Boolean)
}

export const meta: Route.MetaFunction = ({ data }) => {
	const origin = data?.requestInfo.origin ?? ''
	return [
		{ title: data ? 'Quartermaster' : 'Error | Quartermaster' },
		{ name: 'description', content: `Your personal recipe manager` },
		{ name: 'theme-color', content: '#52a868' },
		{ property: 'og:site_name', content: 'Quartermaster' },
		{ property: 'og:title', content: 'Quartermaster' },
		{
			property: 'og:description',
			content: 'Your personal recipe manager',
		},
		{ property: 'og:image', content: `${origin}/og-image.png` },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ property: 'og:type', content: 'website' },
		{ property: 'og:locale', content: 'en_US' },
		{ name: 'twitter:card', content: 'summary_large_image' },
	]
}

export async function loader({ request }: Route.LoaderArgs) {
	const timings = makeTimings('root loader')
	const userId = await time(() => getUserId(request), {
		timings,
		type: 'getUserId',
		desc: 'getUserId in root',
	})

	const user = userId
		? await time(
				() =>
					prisma.user.findUnique({
						select: {
							id: true,
							name: true,
							username: true,
							image: { select: { objectKey: true } },
							roles: {
								select: {
									name: true,
									permissions: {
										select: { entity: true, action: true, access: true },
									},
								},
							},
						},
						where: { id: userId },
					}),
				{ timings, type: 'find user', desc: 'find user in root' },
			)
		: null
	if (userId && !user) {
		console.info('something weird happened')
		// something weird happened... The user is authenticated but we can't find
		// them in the database. Maybe they were deleted? Let's log them out.
		await logout({ request, redirectTo: '/' })
	}

	let tierInfo: TierInfo = {
		tier: 'free',
		isProActive: false,
		trialEndsAt: null,
	}
	let unreadNotificationCount = 0
	let householdName: string | null = null
	if (userId) {
		tierInfo = await getUserTier(userId)
		const member = await prisma.householdMember.findFirst({
			where: { userId },
			select: {
				householdId: true,
				notificationsLastSeenAt: true,
				household: { select: { name: true } },
			},
		})
		if (member) {
			householdName = member.household.name
			unreadNotificationCount = await prisma.householdEvent.count({
				where: {
					householdId: member.householdId,
					userId: { not: userId },
					type: { in: NOTIFY_EVENT_TYPES_LIST },
					...(member.notificationsLastSeenAt
						? { createdAt: { gt: member.notificationsLastSeenAt } }
						: {}),
				},
			})
		}
	}

	const { toast, headers: toastHeaders } = await getToast(request)
	return data(
		{
			user,
			tierInfo,
			unreadNotificationCount,
			householdName,
			requestInfo: {
				hints: getHints(request),
				origin: getDomainUrl(request),
				path: new URL(request.url).pathname,
				userPrefs: {
					theme: getTheme(request),
				},
			},
			ENV: getEnv(),
			toast,
		},
		{
			headers: combineHeaders(
				{ 'Server-Timing': timings.toString() },
				toastHeaders,
			),
		},
	)
}

/**
 * Skip re-running the root loader on normal page-to-page navigations.
 * The root loader provides mostly-static data (user, theme, ENV) and
 * notification count (tracked client-side via SSE).
 *
 * Revalidate when:
 * - After form submissions (toasts, state changes)
 * - Explicit revalidation (useRevalidator — e.g., OS color scheme change)
 * - Same-URL revalidation (defaultShouldRevalidate handles this)
 *
 * Skip when:
 * - Navigating between pages (root data doesn't depend on URL/params)
 * - Search params change on a child route
 */
export function shouldRevalidate({
	defaultShouldRevalidate,
	formAction,
	currentUrl,
	nextUrl,
}: {
	defaultShouldRevalidate: boolean
	formAction?: string
	currentUrl: URL
	nextUrl: URL
}) {
	// Always revalidate after form submissions (actions)
	if (formAction) return true

	// Same URL — respect defaultShouldRevalidate (covers useRevalidator,
	// X-Remix-Revalidate, and other explicit revalidation triggers)
	if (
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search === nextUrl.search
	) {
		return defaultShouldRevalidate
	}

	// URL changed — root loader data doesn't depend on URL or search params
	return false
}

export const headers: Route.HeadersFunction = pipeHeaders

function Document({
	children,
	nonce,
	theme = 'light',
	env = {},
	origin,
	path,
}: {
	children: React.ReactNode
	nonce: string
	theme?: Theme
	env?: Record<string, string | undefined>
	origin?: string
	path?: string
}) {
	const allowIndexing = ENV.ALLOW_INDEXING !== 'false'
	return (
		<html lang="en" className={`${theme} h-full overflow-x-hidden`}>
			<head>
				<ClientHintCheck nonce={nonce} />
				<Meta />
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width,initial-scale=1" />
				{allowIndexing ? null : (
					<meta name="robots" content="noindex, nofollow" />
				)}
				{origin && path ? (
					<link rel="canonical" href={`${origin}${path}`} />
				) : null}
				<Links />
			</head>
			<body className="bg-background text-foreground">
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
				>
					Skip to content
				</a>
				{children}
				<script
					nonce={nonce}
					dangerouslySetInnerHTML={{
						__html: `window.ENV = ${JSON.stringify(env)}`,
					}}
				/>
				<ScrollRestoration nonce={nonce} />
				<Scripts nonce={nonce} />
			</body>
		</html>
	)
}

export function Layout({ children }: { children: React.ReactNode }) {
	// if there was an error running the loader, data could be missing
	const data = useLoaderData<typeof loader | null>()
	const nonce = useNonce()
	const theme = useOptionalTheme()
	return (
		<Document
			nonce={nonce}
			theme={theme}
			env={data?.ENV}
			origin={data?.requestInfo.origin}
			path={data?.requestInfo.path}
		>
			{children}
		</Document>
	)
}

function App() {
	const data = useLoaderData<typeof loader>()
	const user = useOptionalUser()
	const theme = useTheme()
	const isPro = data.tierInfo.isProActive
	useToast(data.toast)

	return (
		<TimerProvider>
			<OpenImgContextProvider
				optimizerEndpoint="/resources/images"
				getSrc={getImgSrc}
			>
				<div className="flex min-h-screen flex-col justify-between">
					<header className="bg-card/80 border-border/50 sticky top-0 z-40 border-b backdrop-blur-sm">
						<nav aria-label="Main" className="container flex flex-wrap items-center justify-between gap-4 py-3 sm:flex-nowrap md:gap-8">
							<Logo />
							<div className="ml-auto flex items-center gap-4 md:gap-10">
								{user ? (
									<>
										<div className="hidden items-center gap-2 md:flex">
											<NavLink
												to="/recipes"
												className={({ isActive }) =>
													isActive
														? 'bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
														: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
												}
											>
												Recipes
											</NavLink>
											<NavLink
												to="/inventory"
												className={({ isActive }) =>
													isActive
														? 'bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
														: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
												}
											>
												Inventory
												{!isPro && <Icon name="lock-closed" size="xs" className="ml-1 inline opacity-40" />}
											</NavLink>
											<NavLink
												to="/plan"
												className={({ isActive }) =>
													isActive
														? 'bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
														: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
												}
											>
												Plan
												{!isPro && <Icon name="lock-closed" size="xs" className="ml-1 inline opacity-40" />}
											</NavLink>
											<NavLink
												to="/shopping"
												className={({ isActive }) =>
													isActive
														? 'bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
														: 'text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200'
												}
											>
												Shopping
												{!isPro && <Icon name="lock-closed" size="xs" className="ml-1 inline opacity-40" />}
											</NavLink>
										</div>
										<NotificationBell />
										<UserDropdown />
									</>
								) : (
									<Button asChild variant="default" size="lg">
										<Link to="/login">Log In</Link>
									</Button>
								)}
							</div>
						</nav>
					</header>

					<main id="main-content" className="flex flex-1 flex-col">
						<Outlet />
					</main>

				</div>
				<BottomNav />
				<Toaster closeButton position="top-center" theme={theme} />
				<OfflineIndicator />
				{user ? <HouseholdActivityNotifier /> : null}
				{user ? <TimerWidget /> : null}
				<Progress />
			</OpenImgContextProvider>
		</TimerProvider>
	)
}

function Logo() {
	return (
		<Link to="/" className="group flex items-center gap-2">
			<span className="text-foreground text-lg font-semibold">
				Quartermaster
			</span>
		</Link>
	)
}

function AppWithProviders() {
	return <App />
}

export default AppWithProviders

// this is a last resort error boundary. There's not much useful information we
// can offer at this level.
export const ErrorBoundary = GeneralErrorBoundary
