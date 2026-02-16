import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import { type Route } from './+types/upgrade.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Upgrade | Quartermaster' }]
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

export default function UpgradePage() {
	return (
		<div className="container max-w-5xl px-4 py-8 md:py-12">
			<div className="mb-8 text-center md:mb-12">
				<h1 className="font-serif text-3xl font-bold tracking-tight md:text-4xl">
					Upgrade Your Kitchen
				</h1>
				<p className="text-muted-foreground mt-2 text-lg">
					Unlock inventory tracking, meal planning, and smart shopping lists.
				</p>
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
