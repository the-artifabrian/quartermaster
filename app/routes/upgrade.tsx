import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link, useFetcher } from 'react-router'
import { ErrorList } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { RedeemCodeSchema } from '#app/utils/invite-code-status.ts'
import { cn } from '#app/utils/misc.tsx'
import { getUserTier, type TierInfo } from '#app/utils/subscription.server.ts'
import { getUserId } from '#app/utils/auth.server.ts'
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
	}
	if (userId) {
		tierInfo = await getUserTier(userId)
	}
	return { tierInfo }
}

const tiers = [
	{
		name: 'Free',
		price: '$0',
		description: 'A complete recipe manager',
		features: [
			'Unlimited recipes',
			'Import from URL or paste',
			'Interactive cooking view',
			'Cooking log & history',
			'Recipe sharing & print',
			'Data export',
		],
		current: true,
	},
	{
		name: 'Pro',
		price: 'TBD',
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
		name: 'Household',
		price: 'TBD',
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
	const { tierInfo } = loaderData

	return (
		<div className="container max-w-5xl px-4 py-8 md:py-12">
			<div className="mb-8 text-center md:mb-12">
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					Upgrade Your Kitchen
				</h1>
				<p className="text-muted-foreground mt-2 text-lg">
					Unlock inventory tracking, meal planning, and smart shopping lists.
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
						You&apos;re on the {tierInfo.tier} plan
					</p>
				) : null}
			</div>

			<div className="grid gap-6 md:grid-cols-3">
				{tiers.map((tier) => (
					<div
						key={tier.name}
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
							<p className="mt-3 text-2xl font-bold">{tier.price}</p>
						</div>
						<ul className="space-y-2">
							{tier.features.map((feature) => (
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
							{tier.current ? (
								<Button variant="outline" className="w-full" disabled>
									Current Plan
								</Button>
							) : (
								<Button
									variant={tier.highlighted ? 'default' : 'outline'}
									className="w-full"
									disabled
								>
									Coming Soon
								</Button>
							)}
						</div>
					</div>
				))}
			</div>

			{!tierInfo.isProActive ? (
				<InviteCodeSection />
			) : null}

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
