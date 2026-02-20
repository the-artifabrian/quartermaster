import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Form, Link, redirect, useFetcher } from 'react-router'
import { ErrorList } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { RedeemCodeSchema } from '#app/utils/invite-code-status.ts'
import {
	createCheckoutSession,
	getStripeClient,
	handleCheckoutCompleted,
	isStripeConfigured,
} from '#app/utils/stripe.server.ts'
import { getUserTier, type TierInfo } from '#app/utils/subscription.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type action as redeemAction } from './resources/redeem-invite-code.tsx'
import { type Route } from './+types/upgrade.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Upgrade | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
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

	// Handle Stripe checkout success redirect
	const url = new URL(request.url)
	const sessionId = url.searchParams.get('session_id')
	if (sessionId && userId) {
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
						title: 'Welcome to Pro!',
						description:
							'Your subscription is active. Enjoy the full kitchen experience.',
					})
				}
			} catch (err) {
				console.error('Error processing Stripe success redirect:', err)
			}
		}
	}

	const stripeConfigured = isStripeConfigured()

	return {
		tierInfo,
		stripeConfigured,
		proYearlyPriceId: stripeConfigured
			? process.env.STRIPE_PRO_YEARLY_PRICE_ID!
			: null,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await getUserId(request)
	if (!userId) {
		return redirect('/login?redirectTo=/upgrade')
	}

	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'checkout') {
		const priceId = formData.get('priceId')
		if (typeof priceId !== 'string' || !priceId) {
			return data({ error: 'Missing price ID' }, { status: 400 })
		}

		const origin = new URL(request.url).origin
		const session = await createCheckoutSession({
			userId,
			priceId,
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
	'Unlimited recipes',
	'Import from URL or paste',
	'Up to 15 inventory items',
	'Smart recipe matching',
	'Interactive cooking view',
	'Cooking log & history',
	'Recipe sharing & print',
	'Data export',
]

const proFeatures = [
	'Everything in Free, plus:',
	'Unlimited inventory',
	'Meal planning calendar',
	'Shopping list generation',
	'Post-cook inventory subtraction',
	'Household sharing',
	'AI substitution hints',
	'AI recipe generation',
]

export default function UpgradePage({ loaderData }: Route.ComponentProps) {
	const { tierInfo, stripeConfigured, proYearlyPriceId } = loaderData

	return (
		<div className="container max-w-3xl px-4 py-8 md:py-12">
			{!tierInfo.isProActive && tierInfo.wasProPreviously ? (
				<div className="bg-card border-border mx-auto mb-8 max-w-2xl rounded-2xl border p-6 text-center">
					<Icon
						name="lock-open-1"
						size="lg"
						className="text-primary mx-auto mb-3"
					/>
					<h2 className="text-lg font-semibold">Your Pro access has ended</h2>
					<p className="text-muted-foreground mt-2 text-sm">
						Your data is safe &mdash; recipes, inventory, meal plans, and
						shopping lists are all preserved. Subscribe or redeem a new invite
						code to pick up where you left off.
					</p>
				</div>
			) : null}

			<div className="mb-8 text-center md:mb-12">
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					Upgrade Your Kitchen
				</h1>
				<p className="text-muted-foreground mt-2 text-lg">
					Unlock unlimited inventory, meal planning, and smart shopping lists.
				</p>
				{tierInfo.isProActive && tierInfo.isTrialing && tierInfo.trialEndsAt ? (
					<p className="text-primary mt-2 text-sm font-medium">
						You have Pro access until{' '}
						{new Date(tierInfo.trialEndsAt).toLocaleDateString('en-US', {
							month: 'long',
							day: 'numeric',
							year: 'numeric',
						})}
					</p>
				) : tierInfo.isProActive ? (
					<p className="text-primary mt-2 text-sm font-medium">
						You&apos;re on the Pro plan
					</p>
				) : null}
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				{/* Free tier */}
				<div className="bg-card rounded-2xl border p-6">
					<div className="mb-4">
						<h2 className="text-xl font-semibold">Free</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							A complete recipe manager
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
						<Button variant="outline" className="w-full" disabled>
							Current Plan
						</Button>
					</div>
				</div>

				{/* Pro tier */}
				<div className="border-primary ring-primary/20 bg-card rounded-2xl border p-6 ring-2">
					<div className="mb-4">
						<h2 className="text-xl font-semibold">Pro</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							The full kitchen intelligence loop
						</p>
						<p className="mt-3 text-2xl font-bold">
							$35
							<span className="text-muted-foreground text-sm font-normal">
								/yr
							</span>
						</p>
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
							proYearlyPriceId={proYearlyPriceId}
						/>
					</div>
				</div>
			</div>

			{!tierInfo.isProActive ? <InviteCodeSection /> : null}

			<div className="mt-8 text-center">
				<Button asChild variant="ghost">
					<Link to="/recipes">
						<Icon name="arrow-left" size="sm" className="mr-1" />
						Back to Recipes
					</Link>
				</Button>
			</div>
		</div>
	)
}

function ProButton({
	tierInfo,
	stripeConfigured,
	proYearlyPriceId,
}: {
	tierInfo: TierInfo
	stripeConfigured: boolean
	proYearlyPriceId: string | null
}) {
	if (tierInfo.isProActive) {
		if (tierInfo.hasStripeSubscription) {
			return (
				<Form method="POST" action="/resources/stripe-portal">
					<Button variant="outline" className="w-full">
						Manage Subscription
					</Button>
				</Form>
			)
		}
		return (
			<Button variant="outline" className="w-full" disabled>
				Current Plan
			</Button>
		)
	}

	// If user has an existing (possibly lapsed) Stripe subscription, show manage
	if (tierInfo.hasStripeSubscription) {
		return (
			<Form method="POST" action="/resources/stripe-portal">
				<Button variant="default" className="w-full">
					Manage Subscription
				</Button>
			</Form>
		)
	}

	// Show checkout button if Stripe is configured
	if (stripeConfigured && proYearlyPriceId) {
		return (
			<Form method="POST">
				<input type="hidden" name="intent" value="checkout" />
				<input type="hidden" name="priceId" value={proYearlyPriceId} />
				<Button type="submit" variant="default" className="w-full">
					Subscribe
				</Button>
			</Form>
		)
	}

	// Stripe not configured
	return (
		<Button variant="default" className="w-full" disabled>
			Coming Soon
		</Button>
	)
}

function InviteCodeSection() {
	const fetcher = useFetcher<typeof redeemAction>()
	const isSubmitting = fetcher.state !== 'idle'

	const [form, fields] = useForm({
		id: 'redeem-invite-code',
		constraint: getZodConstraint(RedeemCodeSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: RedeemCodeSchema })
		},
	})

	return (
		<div className="bg-card mx-auto mt-10 max-w-md rounded-2xl border p-6 text-center">
			<h3 className="text-lg font-semibold">Have an invite code?</h3>
			<p className="text-muted-foreground mt-1 text-sm">
				Enter a code from a friend to unlock Pro features.
			</p>
			<fetcher.Form
				method="POST"
				action="/resources/redeem-invite-code"
				{...getFormProps(form)}
				className="mt-4"
			>
				<div className="flex gap-2">
					<input
						{...getInputProps(fields.code, { type: 'text' })}
						placeholder="QM-A7K2X9"
						className="border-input bg-background placeholder:text-muted-foreground flex-1 rounded-lg border px-3 py-2 text-center font-mono text-sm tracking-widest uppercase"
						autoComplete="off"
					/>
					<StatusButton
						type="submit"
						status={isSubmitting ? 'pending' : 'idle'}
					>
						Redeem
					</StatusButton>
				</div>
				<ErrorList errors={form.errors} id={form.errorId} />
			</fetcher.Form>
		</div>
	)
}
