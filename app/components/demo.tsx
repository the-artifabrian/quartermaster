import { useEffect, useState } from 'react'
import {
	Form,
	useNavigation,
	useRevalidator,
	useRouteLoaderData,
} from 'react-router'
import { type loader as rootLoader } from '#app/root.tsx'
import {
	demoMsLeftNow,
	demoTimeLeftIso,
	demoTimeLeftLabel,
} from '#app/utils/demo.ts'
import { StatusButton } from './ui/status-button.tsx'

type RootData = NonNullable<
	ReturnType<typeof useRouteLoaderData<typeof rootLoader>>
>

/** Whether the signed-in user is a demo visitor, ended or not. */
export function useIsDemo() {
	const data = useRouteLoaderData<typeof rootLoader>('root')
	return data?.demoExpiresAt != null
}

/**
 * When each root loader reading arrived, by the page's clock. Keyed on the
 * reading itself: a tab tap skips the root loader, and a banner that mounted
 * again on an old reading would otherwise count from its time left afresh.
 */
const readingArrivedAt = new WeakMap<RootData, number>()

function msLeftOf(data: RootData, msLeftAtLoad: number) {
	const loadedAt = readingArrivedAt.get(data)
	return loadedAt === undefined
		? msLeftAtLoad
		: demoMsLeftNow({ msLeftAtLoad, loadedAt, now: Date.now() })
}

/**
 * The time left in the demo, by the server's clock, a minute's precision. The
 * first render uses the loader's reading as it is, so the server's HTML and
 * hydration agree whatever the browser's clock says. After that it counts
 * down with the time passed on the page, and reads again when the tab comes
 * back, since a sleeping tab runs no timers.
 */
function useDemoMsLeft(data: RootData, msLeftAtLoad: number) {
	const [msLeft, setMsLeft] = useState(() => msLeftOf(data, msLeftAtLoad))
	useEffect(() => {
		if (!readingArrivedAt.has(data)) readingArrivedAt.set(data, Date.now())
		const update = () => setMsLeft(msLeftOf(data, msLeftAtLoad))
		update()
		const timer = setInterval(update, 10_000)
		const onVisible = () => {
			if (document.visibilityState === 'visible') update()
		}
		document.addEventListener('visibilitychange', onVisible)
		window.addEventListener('pageshow', update)
		return () => {
			clearInterval(timer)
			document.removeEventListener('visibilitychange', onVisible)
			window.removeEventListener('pageshow', update)
		}
	}, [data, msLeftAtLoad])
	return msLeft
}

/**
 * Asks the server once when the demo's time runs out with the page open. The
 * demo's session ends with it, so the root loader sends the visitor home. A
 * reading that already had no time left is the server's answer, so it isn't
 * asked again: a server that still honours the session would otherwise be
 * asked on every tick.
 */
const askedAtEnd = new WeakSet<RootData>()

function useRevalidateAtEnd(
	ended: boolean,
	data: RootData,
	msLeftAtLoad: number,
) {
	const revalidator = useRevalidator()
	useEffect(() => {
		if (!ended || msLeftAtLoad <= 0 || askedAtEnd.has(data)) return
		askedAtEnd.add(data)
		void revalidator.revalidate()
	}, [ended, data, msLeftAtLoad, revalidator])
}

/**
 * The thin bar a demo visitor sees at the top of every app page. It sits
 * inside the site header, so it is pinned with a pushed page's nav bar, the
 * nav bar's measured bottom (toasts, scroll padding) includes it, and in the
 * iOS app it sits below the status bar.
 */
export function DemoBanner() {
	const data = useRouteLoaderData<typeof rootLoader>('root')
	if (!data?.demoExpiresAt || data.demoMsLeft == null) return null
	return <DemoBannerBar data={data} msLeftAtLoad={data.demoMsLeft} />
}

function DemoBannerBar({
	data,
	msLeftAtLoad,
}: {
	data: RootData
	msLeftAtLoad: number
}) {
	const msLeft = useDemoMsLeft(data, msLeftAtLoad)
	const label = demoTimeLeftLabel(msLeft)
	const iso = demoTimeLeftIso(msLeft)
	useRevalidateAtEnd(label === null, data, msLeftAtLoad)
	return (
		<section
			aria-label="Demo"
			data-demo-banner=""
			className="bg-muted text-foreground border-border/50 border-b text-sm print:hidden"
		>
			<div className="desktop:min-h-9 container flex min-h-11 items-center justify-between gap-3">
				<p className="min-w-0">
					{label && iso ? (
						<>
							This demo ends in <time dateTime={iso}>{label}</time>
						</>
					) : (
						'This demo has ended'
					)}
				</p>
				<DemoSignUpForm className="-mr-3 shrink-0">
					{(pending) => (
						<button
							type="submit"
							disabled={pending}
							aria-busy={pending || undefined}
							className="text-primary desktop:min-h-9 min-h-11 rounded-md px-3 font-semibold underline-offset-4 hover:underline disabled:opacity-60"
						>
							Sign up
						</button>
					)}
				</DemoSignUpForm>
			</div>
		</section>
	)
}

/**
 * Ends the demo and opens signup. Signup only takes visitors who aren't
 * signed in, so /demo deletes the demo user and its session on the way.
 */
export function DemoSignUpForm({
	className,
	children,
}: {
	className?: string
	children: (pending: boolean) => React.ReactNode
}) {
	const navigation = useNavigation()
	const pending =
		navigation.state !== 'idle' &&
		navigation.formAction === '/demo' &&
		navigation.formData?.get('intent') === 'end'
	return (
		<Form method="POST" action="/demo" className={className}>
			<input type="hidden" name="intent" value="end" />
			<input type="hidden" name="redirectTo" value="/signup" />
			{children(pending)}
		</Form>
	)
}

/**
 * "Try the demo": starts a demo. `redirectTo` is the page the button is on,
 * where /demo sends the visitor back with a toast when the demo is full. The
 * copy can take a second or two, so the button stays busy until /demo answers.
 */
export function TryDemoButton({
	redirectTo,
	className,
	variant,
}: {
	redirectTo: string
	className?: string
	variant?: 'outline'
}) {
	const navigation = useNavigation()
	const pending =
		navigation.state !== 'idle' &&
		navigation.formAction === '/demo' &&
		navigation.formData?.get('intent') == null
	return (
		<Form method="POST" action="/demo">
			<input
				type="hidden"
				name="redirectTo"
				value={redirectTo}
				// The login page's search can hold an invite link; kept out of
				// session replays, as the login form's own field is.
				className="ph-no-capture"
			/>
			<StatusButton
				type="submit"
				variant={variant}
				status={pending ? 'pending' : 'idle'}
				disabled={pending}
				aria-busy={pending || undefined}
				className={className}
			>
				Try the demo
			</StatusButton>
		</Form>
	)
}
