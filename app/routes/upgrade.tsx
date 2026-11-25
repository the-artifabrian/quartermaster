import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { upgradeNav } from '#app/utils/nav-back.ts'
import { data, Form, Link, redirect } from 'react-router'
import {
	DemoSignUpForm,
	TryDemoButton,
	useIsDemo,
} from '#app/components/demo.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { getAppOrigin } from '#app/utils/app-origin.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
import { isDemoUserId } from '#app/utils/demo-guard.server.ts'
import { isNativeShell } from '#app/utils/native-shell.server.ts'
import {
	CHECKOUT_STARTED,
	UPGRADE_PAGE_VIEWED,
} from '#app/utils/posthog-events.ts'
import {
	captureServerEvent,
	getFeatureFlag,
} from '#app/utils/posthog.server.ts'
import {
	createCheckoutSession,
	getPlanPriceId,
	getStripeClient,
	handleCheckoutCompleted,
	isCheckoutPlan,
	isStripeConfigured,
} from '#app/utils/stripe.server.ts'
import { getUserTier, type TierInfo } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/upgrade.ts'

// Signed in, the nav bar goes back; a visitor keeps the brand header and
// the link home at the end of the page.
export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: upgradeNav,
}

export const meta: Route.MetaFunction = ({ error }) => {
	if (error) return [{ title: 'Quartermaster' }]
	return [{ title: 'Free and Pro | Quartermaster' }]
}

// The iOS app may not point at buying Pro (ADR 0001), so there the page does
// not exist and renders the same not-found page as an unknown route.
export { ErrorBoundary } from './$.tsx'

function throwNotFoundInNativeShell(request: Request) {
	if (isNativeShell(request)) {
		throw new Response('Not found', { status: 404 })
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	throwNotFoundInNativeShell(request)
	const userId = await getUserId(request)
	let tierInfo: TierInfo = {
		tier: 'free',
		isProActive: false,
		isTrialing: false,
		trialEndsAt: null,
		subscriptionExpiresAt: null,
		hasStripeSubscription: false,
		proExpiresAt: null,
		daysUntilExpiry: null,
		wasProPreviously: false,
	}
	if (userId) {
		tierInfo = await getUserTier(userId)
	}

	// Handle Stripe checkout success redirect. A demo user's subscription is
	// the demo's, so their return from checkout changes nothing.
	const url = new URL(request.url)
	const sessionId = url.searchParams.get('session_id')
	if (sessionId && userId && !(await isDemoUserId(userId))) {
		const stripe = getStripeClient()
		if (stripe) {
			try {
				const session = await stripe.checkout.sessions.retrieve(sessionId)
				if (
					session.payment_status === 'paid' &&
					session.client_reference_id === userId
				) {
					// Reuse the webhook handler to avoid duplicating upsert logic
					await handleCheckoutCompleted(session)

					return redirectWithToast('/upgrade', {
						type: 'success',
						title: 'You’re on Pro',
						description: 'Your subscription is active.',
					})
				}
			} catch (err) {
				console.error('Error processing Stripe success redirect:', err)
			}
		}
	}

	if (userId && !sessionId) {
		captureServerEvent(userId, UPGRADE_PAGE_VIEWED, {
			tier: tierInfo.tier,
			is_trialing: tierInfo.isTrialing,
		})
	}

	const stripeConfigured = isStripeConfigured()

	const pricingVariant = userId
		? ((await getFeatureFlag(userId, 'pricing-page-variant')) ?? 'control')
		: 'control'

	return {
		tierInfo,
		stripeConfigured,
		isLoggedIn: !!userId,
		pricingVariant,
	}
}

export async function action({ request }: Route.ActionArgs) {
	throwNotFoundInNativeShell(request)
	const userId = await getUserId(request)
	if (!userId) {
		return redirect('/login?redirectTo=/upgrade')
	}

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'checkout') {
		// The form names a plan, and the price comes from config. A page cached
		// before plans existed sends only its old priceId field, which is
		// ignored: yearly is the plan it offered.
		const plan = formData.get('plan') ?? 'yearly'
		if (!isCheckoutPlan(plan)) {
			return data({ error: 'Unknown plan' }, { status: 400 })
		}
		const priceId = isStripeConfigured() ? getPlanPriceId(plan) : null
		if (!priceId) {
			return data({ error: 'Checkout is not available' }, { status: 400 })
		}

		captureServerEvent(userId, CHECKOUT_STARTED, { price_id: priceId, plan })

		const origin = getAppOrigin()
		const session = await createCheckoutSession({
			userId,
			plan,
			returnUrl: `${origin}/upgrade`,
		})

		if (!session.url) {
			return data(
				{ error: 'Failed to create checkout session' },
				{ status: 500 },
			)
		}

		return redirect(session.url)
	}

	return data({ error: 'Invalid intent' }, { status: 400 })
}

const freeFeatures = [
	'Import from a link or pasted text',
	'A weekly Plan',
	'Shopping picked from your Plan',
	'Household Staples',
	'Recipe times, yield and filters',
	'Tick off steps as you cook',
	'Sharing with your Household',
	'Data export',
]

const proFeatures = [
	'Everything in Free, plus:',
	'Live updates on Shopping',
	'Voice input on Shopping',
	'AI import from text and screenshots',
	'Suggest description & times',
]

export default function UpgradePage({ loaderData }: Route.ComponentProps) {
	const { tierInfo, stripeConfigured, isLoggedIn, pricingVariant } = loaderData
	const isDemo = useIsDemo()

	return (
		<div
			className="container max-w-3xl px-4 py-8 md:py-12"
			data-pricing-variant={pricingVariant}
		>
			{!tierInfo.isProActive && tierInfo.wasProPreviously ? (
				<div className="bg-card border-border mx-auto mb-8 max-w-2xl rounded-lg border p-6 text-center">
					<Icon
						name="lock-open-1"
						size="lg"
						className="text-primary mx-auto mb-3"
					/>
					<h2 className="text-lg font-semibold">Your Pro access has ended</h2>
					<p className="text-muted-foreground mt-2 text-sm">
						Everything you saved is still here.
					</p>
				</div>
			) : null}

			<div className="mb-8 text-center md:mb-12">
				<h1 className="font-serif text-3xl tracking-tight md:text-4xl">
					Free and Pro
				</h1>
				<p className="text-muted-foreground mt-2 text-lg">
					Pro adds the AI tools and live updates.
				</p>
				{tierInfo.isTrialing ? (
					<>
						<p className="text-primary mt-2 text-sm font-medium">
							You have Pro until{' '}
							{new Date(tierInfo.trialEndsAt!).toLocaleDateString('en-US', {
								month: 'long',
								day: 'numeric',
								year: 'numeric',
							})}
						</p>
						<p className="text-muted-foreground mt-1 text-sm">
							After that you keep everything in Free.
						</p>
					</>
				) : tierInfo.isProActive && !isDemo ? (
					<p className="text-primary mt-2 text-sm font-medium">
						You&apos;re on Pro
					</p>
				) : null}
			</div>

			{isDemo ? <DemoProNote /> : null}

			<div className="grid gap-6 md:grid-cols-2">
				<div className="bg-card rounded-lg border p-6">
					<div className="mb-4">
						<h2 className="text-xl font-semibold">Free</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							No card and no time limit
						</p>
						<p className="mt-3 text-2xl font-bold">$0</p>
					</div>
					<ul className="space-y-2">
						{freeFeatures.map((feature) => (
							<li key={feature} className="flex items-start gap-2 text-sm">
								<Icon
									name="check"
									size="sm"
									className="text-primary mt-0.5 shrink-0"
								/>
								{feature}
							</li>
						))}
					</ul>
					<div className="mt-6">
						{isLoggedIn ? (
							// Only one card is current: a trial or the demo is on Pro.
							tierInfo.isProActive ? null : (
								<Button variant="outline" className="w-full" disabled>
									Current
								</Button>
							)
						) : (
							<Button asChild variant="outline" className="w-full">
								<Link to="/signup">Sign up free</Link>
							</Button>
						)}
					</div>
				</div>

				<div className="border-primary ring-primary/20 bg-card rounded-lg border p-6 ring-2">
					<div className="mb-4">
						<h2 className="text-xl font-semibold">Pro</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							A reference implementation of a paid tier
						</p>
						{/* A price only means something while checkout is on. */}
						{stripeConfigured ? (
							<p className="mt-3 text-2xl font-bold">
								$35
								<span className="text-muted-foreground text-sm font-normal">
									/yr
								</span>
							</p>
						) : null}
					</div>
					<ul className="space-y-2">
						{proFeatures.map((feature) => (
							<li key={feature} className="flex items-start gap-2 text-sm">
								<Icon
									name="check"
									size="sm"
									className="text-primary mt-0.5 shrink-0"
								/>
								{feature}
							</li>
						))}
					</ul>
					<div className="mt-6">
						<ProButton
							tierInfo={tierInfo}
							stripeConfigured={stripeConfigured}
							isLoggedIn={isLoggedIn}
						/>
					</div>
				</div>
			</div>

			{isLoggedIn ? null : (
				<div className="mt-8 text-center">
					<Button asChild variant="ghost">
						<Link to="/">
							<Icon name="arrow-left" size="sm" className="mr-1" />
							Back to home
						</Link>
					</Button>
				</div>
			)}
		</div>
	)
}

// A demo user is on Pro until the demo ends, and checkout is off for them
// (the server refuses it too). This says why, in place of the checkout.
function DemoProNote() {
	return (
		<div className="bg-card border-border mx-auto mb-8 max-w-2xl rounded-lg border p-6">
			<h2 className="text-lg font-semibold">Pro in the demo</h2>
			<p className="text-muted-foreground mt-2 text-sm">
				The demo runs as Pro, so there&apos;s no checkout. Pro isn&apos;t on
				sale. It&apos;s a reference implementation, with Stripe Checkout and its
				webhooks built and tested.
			</p>
			<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
				<DemoSignUpForm>
					{(pending) => (
						<Button
							type="submit"
							disabled={pending}
							aria-busy={pending || undefined}
						>
							Sign up
						</Button>
					)}
				</DemoSignUpForm>
				<p className="text-muted-foreground text-sm">
					A new account starts empty.
				</p>
			</div>
		</div>
	)
}

function ProButton({
	tierInfo,
	stripeConfigured,
	isLoggedIn,
}: {
	tierInfo: TierInfo
	stripeConfigured: boolean
	isLoggedIn: boolean
}) {
	if (tierInfo.isProActive) {
		if (tierInfo.hasStripeSubscription) {
			return (
				<Form method="POST" action="/resources/stripe-portal">
					<Button variant="outline" className="w-full">
						Manage subscription
					</Button>
				</Form>
			)
		}
		return (
			<Button variant="outline" className="w-full" disabled>
				Current
			</Button>
		)
	}

	// If user has an existing (possibly lapsed) Stripe subscription, show manage
	if (tierInfo.hasStripeSubscription) {
		return (
			<Form method="POST" action="/resources/stripe-portal">
				<Button variant="default" className="w-full">
					Manage subscription
				</Button>
			</Form>
		)
	}

	// Show checkout button if Stripe is configured
	if (stripeConfigured) {
		return (
			<Form method="POST">
				<input type="hidden" name="intent" value="checkout" />
				<input type="hidden" name="plan" value="yearly" />
				<Button type="submit" variant="default" className="w-full">
					Subscribe
				</Button>
			</Form>
		)
	}

	// Stripe isn't configured: Pro isn't on sale. A visitor can try it in the
	// demo. A signed-in user can't start a demo, so they get no pointer to it.
	if (isLoggedIn) {
		return (
			<p className="text-muted-foreground text-sm">Pro isn&apos;t on sale.</p>
		)
	}
	return (
		<>
			<p className="text-muted-foreground mb-3 text-sm">
				Pro isn&apos;t on sale. The demo runs as Pro, so you can try everything
				there.
			</p>
			<TryDemoButton redirectTo="/upgrade" className="w-full" />
		</>
	)
}
