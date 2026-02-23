import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'

interface Step {
	title: string
	description: string
	icon: IconName
	href: string
	done: boolean
}

export function GettingStartedChecklist({
	onboarding,
	isProActive = true,
}: {
	onboarding: {
		hasRecipes: boolean
		hasInventory: boolean
		hasMealPlan: boolean
	}
	isProActive?: boolean
}) {
	const user = useUser()
	const storageKey = `getting-started-dismissed:${user.id}`
	const [dismissed, setDismissed] = useState(false)

	useEffect(() => {
		if (localStorage.getItem(storageKey) === 'true') {
			setDismissed(true)
		}
	}, [storageKey])

	const allSteps: Step[] = [
		{
			title: 'Add your first recipe',
			description: 'Type one in, paste text, or import from a URL',
			icon: 'file-text',
			href: '/recipes/new',
			done: onboarding.hasRecipes,
		},
		{
			title: 'Stock your kitchen',
			description: "Tell us what's in your pantry, fridge, and freezer",
			icon: 'home',
			href: '/inventory',
			done: onboarding.hasInventory,
		},
		{
			title: 'Plan a meal',
			description: 'Add a recipe to your weekly meal plan',
			icon: 'cookie',
			href: '/plan',
			done: onboarding.hasMealPlan,
		},
	]

	// Free users see recipe + inventory steps — meal plan is Pro-only
	const steps = isProActive ? allSteps : allSteps.slice(0, 2)

	const completedCount = steps.filter((s) => s.done).length
	const allComplete = completedCount === steps.length

	if (allComplete || dismissed) return null

	const handleDismiss = () => {
		localStorage.setItem(storageKey, 'true')
		setDismissed(true)
	}

	return (
		<div className="bg-card border-border/50 shadow-warm mb-6 rounded-2xl border p-5">
			{/* Header */}
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h2 className="font-serif text-lg">Getting Started</h2>
					<p className="text-muted-foreground text-sm">
						{completedCount} of {steps.length} complete
					</p>
				</div>
				<button
					type="button"
					onClick={handleDismiss}
					className="text-muted-foreground hover:text-foreground -mr-1 rounded-md p-1 transition-colors"
					aria-label="Dismiss getting started checklist"
				>
					<Icon name="cross-1" size="sm" />
				</button>
			</div>

			{/* Progress bar */}
			<div className="bg-muted mb-4 h-1.5 overflow-hidden rounded-full">
				<div
					className="bg-primary h-full rounded-full transition-all duration-500 ease-out"
					style={{ width: `${(completedCount / steps.length) * 100}%` }}
				/>
			</div>

			{/* Steps */}
			<div className="space-y-2">
				{steps.map((step) => (
					<div
						key={step.title}
						className={cn(
							'flex items-center gap-3 rounded-xl px-4 py-3',
							step.done ? 'bg-secondary/30' : 'bg-muted/30',
						)}
					>
						<div
							className={cn(
								'flex size-8 shrink-0 items-center justify-center rounded-full',
								step.done
									? 'bg-primary text-primary-foreground'
									: 'bg-background border-border border',
							)}
						>
							<Icon name={step.done ? 'check' : step.icon} size="sm" />
						</div>
						<div className="min-w-0 flex-1">
							<p
								className={cn(
									'text-sm font-medium',
									step.done && 'text-muted-foreground line-through',
								)}
							>
								{step.title}
							</p>
							<p className="text-muted-foreground text-xs">
								{step.description}
							</p>
						</div>
						{!step.done && (
							<Link
								to={step.href}
								className="text-primary hover:text-primary/80 shrink-0 text-sm font-medium"
							>
								Start
							</Link>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
