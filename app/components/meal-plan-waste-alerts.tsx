import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'

type WasteAlertData = {
	ingredientName: string
	usedInRecipeTitle: string
	suggestedRecipes: Array<{ id: string; title: string }>
}

type SharedIngredientData = {
	name: string
	recipeNames: string[]
}

type MealPlanWasteAlertsProps = {
	efficiencyScore: number
	sharedCount: number
	uniqueCount: number
	totalSlots: number
	sharedIngredients: SharedIngredientData[]
	alerts: WasteAlertData[]
}

type RecipePairBridge = {
	key: string
	recipeNames: string[]
	ingredients: string[]
}

type RecipeSuggestion = {
	id: string
	title: string
	ingredients: string[]
}

function groupByRecipePair(
	sharedIngredients: SharedIngredientData[],
): RecipePairBridge[] {
	const groups = new Map<string, { recipeNames: string[]; ingredients: string[] }>()

	for (const item of sharedIngredients) {
		const sorted = [...item.recipeNames].sort()
		const key = sorted.join(' ↔ ')
		const existing = groups.get(key)
		if (existing) {
			existing.ingredients.push(item.name)
		} else {
			groups.set(key, { recipeNames: sorted, ingredients: [item.name] })
		}
	}

	return [...groups.entries()]
		.map(([key, value]) => ({ key, ...value }))
		.sort((a, b) => b.ingredients.length - a.ingredients.length)
}

function getTopSuggestions(
	alerts: WasteAlertData[],
	limit = 5,
): RecipeSuggestion[] {
	const recipeMap = new Map<string, { title: string; ingredients: Set<string> }>()

	for (const alert of alerts) {
		for (const recipe of alert.suggestedRecipes) {
			const existing = recipeMap.get(recipe.id)
			if (existing) {
				existing.ingredients.add(alert.ingredientName)
			} else {
				recipeMap.set(recipe.id, {
					title: recipe.title,
					ingredients: new Set([alert.ingredientName]),
				})
			}
		}
	}

	return [...recipeMap.entries()]
		.map(([id, { title, ingredients }]) => ({
			id,
			title,
			ingredients: [...ingredients],
		}))
		.sort((a, b) => b.ingredients.length - a.ingredients.length)
		.slice(0, limit)
}

export function MealPlanWasteAlerts({
	efficiencyScore,
	sharedCount,
	uniqueCount,
	totalSlots,
	sharedIngredients,
	alerts,
}: MealPlanWasteAlertsProps) {
	const [isExpanded, setIsExpanded] = useState(false)

	const efficiencyPct = Math.round((1 - efficiencyScore) * 100)

	const recipePairs = groupByRecipePair(sharedIngredients)
	const suggestions = getTopSuggestions(alerts)

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
							{totalSlots} ingredients, {uniqueCount} unique &middot;{' '}
							{sharedCount} shared across recipes
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

			{isExpanded && (recipePairs.length > 0 || suggestions.length > 0) && (
				<div className="mt-3 space-y-4 border-t pt-3">
					{/* Ingredient Bridges — grouped by recipe pair */}
					{recipePairs.length > 0 && (
						<div className="space-y-1">
							<p className="text-muted-foreground text-xs font-medium">
								Shared ingredients between recipes:
							</p>
							{recipePairs.map((pair) => (
								<div
									key={pair.key}
									className="flex flex-col gap-0.5 py-1.5"
								>
									<p className="text-sm">
										<span className="font-medium">
											{pair.recipeNames.join(' ↔ ')}
										</span>
									</p>
									<p className="text-muted-foreground text-xs">
										{pair.ingredients.join(', ')}
									</p>
								</div>
							))}
						</div>
					)}

					{/* Recipes to consider — ranked by shared ingredient count */}
					{suggestions.length > 0 && (
						<div className="space-y-1">
							<p className="text-muted-foreground text-xs font-medium">
								Recipes to consider adding:
							</p>
							{suggestions.map((suggestion) => (
								<div
									key={suggestion.id}
									className="flex items-baseline gap-2 py-1"
								>
									<Link
										to={`/recipes/${suggestion.id}`}
										className="text-sm font-medium underline decoration-dotted underline-offset-2"
									>
										{suggestion.title}
									</Link>
									<span className="text-muted-foreground text-xs">
										would share {suggestion.ingredients.length}{' '}
										{suggestion.ingredients.length === 1
											? 'ingredient'
											: 'ingredients'}{' '}
										({suggestion.ingredients.join(', ')})
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	)
}
