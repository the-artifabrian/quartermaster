import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useState } from 'react'
import { data, Form, Link, redirect, useFetcher } from 'react-router'
import { ErrorList } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { RedeemCodeSchema } from '#app/utils/invite-code-status.ts'
import { cn } from '#app/utils/misc.tsx'
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
		prices: stripeConfigured
			? {
					proMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
					proYearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
					householdMonthly:
						process.env.STRIPE_HOUSEHOLD_MONTHLY_PRICE_ID ?? null,
					householdYearly:
						process.env.STRIPE_HOUSEHOLD_YEARLY_PRICE_ID ?? null,
				}
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

const tierDefinitions = [
	{
		key: 'free' as const,
		name: 'Free',
		monthlyPrice: 0,
		yearlyPrice: 0,
		description: 'A complete recipe manager',
		features: [
			'Unlimited recipes',
			'Import from URL or paste',
			'Interactive cooking view',
			'Cooking log & history',
			'Recipe sharing & print',
			'Data export',
		],
	},
	{
		key: 'pro' as const,
		name: 'Pro',
		monthlyPrice: 5,
		yearlyPrice: 49,
		description: 'The full kitchen intelligence loop',
		features: [
			'Everything in Free',
			'Inventory tracking',
			'Smart recipe matching',
			'Meal planning calendar',
			'Shopping list generation',
			'Post-cook inventory subtraction',
			'"What do I need?" checklist',
			'Expiring ingredient alerts',
		],
		highlighted: true,
	},
	{
		key: 'household' as const,
		name: 'Household',
		monthlyPrice: 7,
		yearlyPrice: 69,
		description: 'Pro for the whole household',
		features: [
			'Everything in Pro',
			'Shared recipes & inventory',
			'Shared meal plans',
			'Real-time activity feed',
			'Multiple household members',
		],
	},
]

export default function UpgradePage({ loaderData }: Route.ComponentProps) {
	const { tierInfo, stripeConfigured, prices } = loaderData
	const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>(
		'yearly',
	)

	const currentTierKey =
		tierInfo.isProActive && tierInfo.tier !== 'free'
			? tierInfo.tier
			: tierInfo.isProActive
				? 'pro'
				: 'free'

	return (
		<div className="container max-w-5xl px-4 py-8 md:py-12">
			{!tierInfo.isProActive && tierInfo.wasProPreviously ? (
				<div className="bg-card border-border mx-auto mb-8 max-w-2xl rounded-2xl border p-6 text-center">
					<Icon name="lock-open-1" size="lg" className="text-primary mx-auto mb-3" />
					<h2 className="text-lg font-semibold">
						Your Pro access has ended
					</h2>
					<p className="text-muted-foreground mt-2 text-sm">
						Your data is safe &mdash; recipes, inventory, meal plans, and
						shopping lists are all preserved. Subscribe or redeem a new
						invite code to pick up where you left off.
					</p>
				</div>
			) : null}

			<div className="mb-8 text-center md:mb-12">
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					Upgrade Your Kitchen
				</h1>
				<p className="text-muted-foreground mt-2 text-lg">
					Unlock inventory tracking, meal planning, and smart shopping lists.
				</p>
				{tierInfo.isProActive &&
				tierInfo.isTrialing &&
				tierInfo.trialEndsAt ? (
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
						You&apos;re on the {tierInfo.tier} plan
					</p>
				) : null}
			</div>

			{stripeConfigured ? (
				<div className="mb-8 flex justify-center">
					<div className="bg-muted inline-flex rounded-full p-1">
						<button
							type="button"
							onClick={() => setBillingPeriod('monthly')}
							className={cn(
								'rounded-full px-4 py-1.5 text-sm font-medium transition-all',
								billingPeriod === 'monthly'
									? 'bg-card text-foreground shadow-sm'
									: 'text-muted-foreground',
							)}
						>
							Monthly
						</button>
						<button
							type="button"
							onClick={() => setBillingPeriod('yearly')}
							className={cn(
								'rounded-full px-4 py-1.5 text-sm font-medium transition-all',
								billingPeriod === 'yearly'
									? 'bg-card text-foreground shadow-sm'
									: 'text-muted-foreground',
							)}
						>
							Yearly
							<span className="text-primary ml-1 text-xs font-bold">
								Save 18%
							</span>
						</button>
					</div>
				</div>
			) : null}

			<div className="grid gap-6 md:grid-cols-3">
				{tierDefinitions.map((tier) => {
					const isCurrent = currentTierKey === tier.key
					const price =
						billingPeriod === 'monthly'
							? tier.monthlyPrice
							: tier.yearlyPrice
					const priceLabel =
						tier.key === 'free'
							? '$0'
							: billingPeriod === 'monthly'
								? `$${price}/mo`
								: `$${price}/yr`

					let priceId: string | null = null
					if (prices && tier.key === 'pro') {
						priceId =
							billingPeriod === 'monthly'
								? prices.proMonthly
								: prices.proYearly
					} else if (prices && tier.key === 'household') {
						priceId =
							billingPeriod === 'monthly'
								? prices.householdMonthly
								: prices.householdYearly
					}

					return (
						<div
							key={tier.key}
							className={cn(
								'bg-card rounded-2xl border p-6',
								tier.highlighted &&
									'border-primary ring-primary/20 ring-2',
							)}
						>
							<div className="mb-4">
								<h2 className="text-xl font-semibold">{tier.name}</h2>
								<p className="text-muted-foreground mt-1 text-sm">
									{tier.description}
								</p>
								<p className="mt-3 text-2xl font-bold">{priceLabel}</p>
							</div>
							<ul className="space-y-2">
								{tier.features.map((feature) => (
									<li
										key={feature}
										className="flex items-start gap-2 text-sm"
									>
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
								<TierButton
									tierKey={tier.key}
									isCurrent={isCurrent}
									isHighlighted={tier.highlighted ?? false}
									priceId={priceId}
									stripeConfigured={stripeConfigured}
									hasStripeSubscription={
										tierInfo.hasStripeSubscription
									}
								/>
							</div>
						</div>
					)
				})}
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

function TierButton({
	tierKey,
	isCurrent,
	isHighlighted,
	priceId,
	stripeConfigured,
	hasStripeSubscription,
}: {
	tierKey: string
	isCurrent: boolean
	isHighlighted: boolean
	priceId: string | null
	stripeConfigured: boolean
	hasStripeSubscription: boolean
}) {
	if (isCurrent) {
		if (hasStripeSubscription) {
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

	if (tierKey === 'free') {
		return (
			<Button variant="outline" className="w-full" disabled>
				Current Plan
			</Button>
		)
	}

	// For paid tiers: if user has existing Stripe subscription, show manage button
	if (hasStripeSubscription) {
		return (
			<Form method="POST" action="/resources/stripe-portal">
				<Button
					variant={isHighlighted ? 'default' : 'outline'}
					className="w-full"
				>
					Manage Subscription
				</Button>
			</Form>
		)
	}

	// Show checkout button if Stripe is configured and we have a price ID
	if (stripeConfigured && priceId) {
		return (
			<Form method="POST">
				<input type="hidden" name="intent" value="checkout" />
				<input type="hidden" name="priceId" value={priceId} />
				<Button
					type="submit"
					variant={isHighlighted ? 'default' : 'outline'}
					className="w-full"
				>
					Subscribe
				</Button>
			</Form>
		)
	}

	// Stripe not configured — show disabled button
	return (
		<Button
			variant={isHighlighted ? 'default' : 'outline'}
			className="w-full"
			disabled
		>
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
						className="border-input bg-background placeholder:text-muted-foreground flex-1 rounded-lg border px-3 py-2 text-center font-mono text-sm uppercase tracking-widest"
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
