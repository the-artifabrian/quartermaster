import { Link, type useFetcher } from 'react-router'
import { SubstitutionHint } from '#app/components/ingredient-substitution.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'
import { parseAmount, scaleAmount } from '#app/utils/fractions.ts'
import {
	convertToMetric,
	formatMetricAmount,
} from '#app/utils/metric-conversion.ts'
import { cn } from '#app/utils/misc.tsx'
import { type AppliedSubstitution } from '#app/utils/recipe-detail.ts'

export function IngredientList({
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	missingIngredientIds,
	isProActive,
	recipeId,
	substitutions,
	onApplySubstitution,
	onRevertSubstitution,
	shoppingFetcher,
	useMetric,
	onToggleMetric,
}: {
	ingredients: Array<{
		id: string
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
	}>
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	missingIngredientIds: string[]
	isProActive: boolean
	recipeId: string
	substitutions: Map<string, AppliedSubstitution>
	onApplySubstitution: (
		ingredientId: string,
		originalName: string,
		replacement: string,
	) => void
	onRevertSubstitution: (ingredientId: string) => void
	shoppingFetcher: ReturnType<typeof useFetcher>
	useMetric?: boolean
	onToggleMetric?: () => void
}) {
	const missingSet = new Set(missingIngredientIds)
	const nonHeadingCount = ingredients.filter((i) => !i.isHeading).length
	const substitutedCount = missingIngredientIds.filter((id) =>
		substitutions.has(id),
	).length
	const haveCount =
		nonHeadingCount - missingIngredientIds.length + substitutedCount
	const missingCount = missingIngredientIds.length - substitutedCount

	const shoppingData = shoppingFetcher.data as
		| { addedToShoppingList?: number }
		| undefined
	const addedToList = shoppingData?.addedToShoppingList
	const isAddingToList = shoppingFetcher.state !== 'idle'

	function handleAddToShoppingList() {
		const formData = new FormData()
		formData.set('intent', 'add-to-shopping-list')
		formData.set('servingRatio', ratio.toString())
		void shoppingFetcher.submit(formData, { method: 'POST' })
	}

	return (
		<>
			<ul className="space-y-0.5 leading-[1.7]">
				{ingredients.map((ingredient) => {
					if (ingredient.isHeading) {
						return (
							<li key={ingredient.id}>
								<p className="text-muted-foreground font-serif mt-4 mb-1.5 border-b border-border/50 px-2 pb-1 text-sm font-semibold tracking-wider [font-variant:small-caps] first:mt-0">
									{ingredient.name}
								</p>
							</li>
						)
					}

					const isChecked = checkedIngredients.has(ingredient.id)
					const isMissing = missingSet.has(ingredient.id)
					const sub = substitutions.get(ingredient.id)

					return (
						<li
							key={ingredient.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors select-none',
								'hover:bg-accent/5',
								'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
							)}
							onClick={() => onToggle(ingredient.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									onToggle(ingredient.id)
								}
							}}
						>
							<span
								className={cn(
									'flex size-6 shrink-0 items-center justify-center rounded border transition-colors',
									isChecked
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-muted-foreground/25 bg-muted/30',
								)}
							>
								{isChecked && <Icon name="check" className="size-4" />}
							</span>
							<span
								className={cn(
									'min-w-0 flex-1 transition-colors',
									isChecked && 'text-muted-foreground/40 line-through decoration-muted-foreground/30',
								)}
							>
								{(() => {
									const scaledAmount = ingredient.amount
										? scaleAmount(ingredient.amount, ratio)
										: null
									const parsed =
										scaledAmount !== null
											? parseAmount(scaledAmount)
											: null
									const metricResult =
										useMetric && parsed !== null && ingredient.unit
											? convertToMetric(
													parsed,
													ingredient.unit,
													ingredient.name,
												)
											: null

									return metricResult ? (
										<span className="font-medium">
											{metricResult.approximate ? '~ ' : ''}
											{formatMetricAmount(metricResult)}{' '}
										</span>
									) : (
										<>
											{scaledAmount !== null && (
												<span className="font-medium">
													{scaledAmount}{' '}
												</span>
											)}
											{ingredient.unit && (
												<span>{ingredient.unit} </span>
											)}
										</>
									)
								})()}
								{sub ? (
									<>
										<span className="text-amber-700 dark:text-amber-400">
											{sub.replacementShort}
										</span>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													aria-label={`Revert to ${sub.originalName}`}
													className="ml-0.5 inline-flex translate-y-px text-amber-500/70 hover:text-amber-700 dark:hover:text-amber-300"
													onClick={(e) => {
														e.stopPropagation()
														onRevertSubstitution(ingredient.id)
													}}
												>
													<Icon name="reset" className="size-3" />
												</button>
											</TooltipTrigger>
											<TooltipContent>
												Revert to {sub.originalName}
											</TooltipContent>
										</Tooltip>
									</>
								) : isMissing && isProActive ? (
									<SubstitutionHint
										ingredientName={ingredient.name}
										isProActive={isProActive}
										recipeId={recipeId}
										onApply={(replacement) =>
											onApplySubstitution(
												ingredient.id,
												ingredient.name,
												replacement,
											)
										}
									>
										{ingredient.name}
									</SubstitutionHint>
								) : (
									<span>{ingredient.name}</span>
								)}
								{ingredient.notes && (
									<span className={isChecked ? '' : 'text-muted-foreground'}>
										, {ingredient.notes}
									</span>
								)}
							</span>
						</li>
					)
				})}
			</ul>

			{/* Summary footer */}
			<div className="mt-5 space-y-2 border-t pt-3 print:hidden">
				<div className="flex items-center px-1">
					<p className="text-muted-foreground text-xs">
						You have {haveCount}/{nonHeadingCount} ingredients
					</p>
					{onToggleMetric && (
						<button
							type="button"
							onClick={onToggleMetric}
							className={cn(
								'ml-auto rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
								useMetric
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
							)}
						>
							g/ml
						</button>
					)}
				</div>
				{missingCount > 0 && (
					<>
						{addedToList !== undefined ? (
							<div className="px-1 text-center">
								<p className="text-xs text-green-600">
									<Icon name="check" className="mr-1 inline size-3.5" />
									Added {addedToList} item
									{addedToList !== 1 ? 's' : ''} to shopping list
								</p>
								<Link
									to="/shopping"
									className="text-primary mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
								>
									View Shopping List
									<Icon name="arrow-right" className="size-3" />
								</Link>
							</div>
						) : (
							<Button
								variant="outline"
								size="sm"
								className="w-full gap-1.5 text-xs"
								onClick={handleAddToShoppingList}
								disabled={isAddingToList}
							>
								<Icon name="plus" size="sm" />
								{isAddingToList
									? 'Adding...'
									: `Add ${missingCount} missing to Shopping List`}
							</Button>
						)}
					</>
				)}
			</div>
		</>
	)
}
