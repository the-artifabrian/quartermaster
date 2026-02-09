import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'

type WasteAlertData = {
	ingredientName: string
	usedInRecipeTitle: string
	suggestedRecipes: Array<{ id: string; title: string }>
}

type MealPlanWasteAlertsProps = {
	efficiencyScore: number
	sharedCount: number
	alerts: WasteAlertData[]
}

export function MealPlanWasteAlerts({
	efficiencyScore,
	sharedCount,
	alerts,
}: MealPlanWasteAlertsProps) {
	const [isExpanded, setIsExpanded] = useState(false)

	const efficiencyPct = Math.round((1 - efficiencyScore) * 100)

	return (
		<div className="bg-muted/30 rounded-lg border p-4">
			<button
				type="button"
				className="flex w-full items-center justify-between"
				onClick={() => setIsExpanded(!isExpanded)}
			>
				<div className="flex items-center gap-3">
					<div
						className={cn(
							'flex size-8 items-center justify-center rounded-full',
							efficiencyPct > 30
								? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
								: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
						)}
					>
						<Icon name="cookie" size="sm" />
					</div>
					<div className="text-left">
						<p className="text-sm font-medium">
							{efficiencyPct}% ingredient overlap
						</p>
						<p className="text-muted-foreground text-xs">
							{sharedCount} ingredient{sharedCount !== 1 ? 's' : ''} shared
							across recipes
							{alerts.length > 0 && (
								<>
									{' '}
									&middot; {alerts.length} waste alert
									{alerts.length !== 1 ? 's' : ''}
								</>
							)}
						</p>
					</div>
				</div>
				<Icon
					name="chevron-down"
					size="sm"
					className={cn(
						'text-muted-foreground transition-transform',
						isExpanded && 'rotate-180',
					)}
				/>
			</button>

			{isExpanded && alerts.length > 0 && (
				<div className="mt-3 space-y-2 border-t pt-3">
					<p className="text-muted-foreground text-xs font-medium">
						Single-use ingredients you could use in more recipes:
					</p>
					{alerts.map((alert) => (
						<div
							key={alert.ingredientName}
							className="bg-background rounded-md p-3"
						>
							<p className="text-sm">
								<span className="font-medium">{alert.ingredientName}</span>
								<span className="text-muted-foreground">
									{' '}
									&mdash; only in {alert.usedInRecipeTitle}
								</span>
							</p>
							<div className="mt-1 flex flex-wrap gap-1">
								{alert.suggestedRecipes.slice(0, 3).map((recipe) => (
									<Button
										key={recipe.id}
										asChild
										variant="outline"
										size="sm"
										className="h-6 text-xs"
									>
										<Link to={`/recipes/${recipe.id}`}>{recipe.title}</Link>
									</Button>
								))}
								{alert.suggestedRecipes.length > 3 && (
									<span className="text-muted-foreground self-center text-xs">
										+{alert.suggestedRecipes.length - 3} more
									</span>
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
