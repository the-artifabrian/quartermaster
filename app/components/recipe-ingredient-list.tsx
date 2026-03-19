import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
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

export function IngredientList({
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	missingIngredientIds,
	recipeId,
	shoppingFetcher,
	useMetric,
	onToggleMetric,
	showFooter,
}: {
	ingredients: Array<{
		id: string
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
		isHeading: boolean
		linkedRecipeId?: string | null
		linkedRecipe?: { title: string } | null
	}>
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	missingIngredientIds: string[]
	recipeId: string
	shoppingFetcher: ReturnType<typeof useFetcher>
	useMetric?: boolean
	onToggleMetric?: () => void
	showFooter?: boolean
}) {
	const [localHaveIds, setLocalHaveIds] = useState<Set<string>>(
		() => new Set(),
	)

	// Clear optimistic state when loader revalidates (server is now authoritative)
	const prevMissingRef = useRef(missingIngredientIds)
	useEffect(() => {
		if (prevMissingRef.current !== missingIngredientIds) {
			prevMissingRef.current = missingIngredientIds
			setLocalHaveIds(new Set())
		}
	}, [missingIngredientIds])

	const isOptional = (ingredient: { notes: string | null; name: string }) =>
		(ingredient.notes && /\boptional\b/i.test(ingredient.notes)) ||
		/\boptional\b/i.test(ingredient.name)
	const nonHeadingCount = ingredients.filter(
		(i) => !i.isHeading && !isOptional(i),
	).length
	const effectiveMissingIds = missingIngredientIds.filter(
		(id) => !localHaveIds.has(id),
	)
	const effectiveMissingSet = new Set(effectiveMissingIds)
	const haveCount = nonHeadingCount - effectiveMissingIds.length
	const missingCount = effectiveMissingIds.length

	const shoppingData = shoppingFetcher.data as
		| { addedToShoppingList?: number }
		| undefined
	const addedToList = shoppingData?.addedToShoppingList
	const isAddingToList = shoppingFetcher.state !== 'idle'

	function handleAddToShoppingList() {
		const formData = new FormData()
		formData.set('intent', 'add-to-shopping-list')
		formData.set('servingRatio', ratio.toString())
		if (useMetric) {
			formData.set('useMetric', '1')
		}
		void shoppingFetcher.submit(formData, { method: 'POST' })
	}

	function handleMarkedHave(ingredientId: string) {
		setLocalHaveIds((prev) => new Set([...prev, ingredientId]))
	}

	return (
		<>
			<ul className="space-y-1 leading-[1.7] print:columns-2 print:gap-x-6 print:space-y-0 print:text-sm print:leading-[1.5]">
				{ingredients.map((ingredient) => {
					if (ingredient.isHeading) {
						return (
							<li key={ingredient.id}>
								<p className="text-muted-foreground font-sans mt-4 mb-1.5 border-b border-border/50 px-2 pb-1 text-xs font-medium uppercase tracking-widest print:mt-2 print:mb-0.5 print:px-0 print:text-[10px] print:break-inside-avoid-column first:mt-0">
									{ingredient.name}
								</p>
							</li>
						)
					}

					const isChecked = checkedIngredients.has(ingredient.id)
					const isMissing = effectiveMissingSet.has(ingredient.id)

					return (
						<li
							key={ingredient.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors select-none',
								'hover:bg-accent/5',
								'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
								'print:gap-1.5 print:rounded-none print:px-0 print:py-0.5',
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
									'flex size-6 shrink-0 items-center justify-center rounded border transition-colors print:hidden',
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
								{ingredient.linkedRecipeId ? (
									<Link
										to={`/recipes/${ingredient.linkedRecipeId}`}
										className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary/60"
										onClick={(e) => e.stopPropagation()}
									>
										{ingredient.name}
									</Link>
								) : (
									<span>{ingredient.name}</span>
								)}
								{ingredient.notes && (
									<span
										className={
											isChecked
												? ''
												: 'text-muted-foreground'
										}
									>
										, {ingredient.notes}
									</span>
								)}
							</span>
							{isMissing && !isChecked && !ingredient.linkedRecipeId && (
								<MissingIngredientActions
									ingredientId={ingredient.id}
									recipeId={recipeId}
									ratio={ratio}
									useMetric={useMetric}
									onMarkedHave={handleMarkedHave}
								/>
							)}
						</li>
					)
				})}
			</ul>

			{/* Summary footer */}
			{showFooter !== false && (
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
									'ml-auto rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
									useMetric
										? 'border-primary bg-primary text-primary-foreground'
										: 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
								)}
							>
								Metric
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
									className="w-full min-h-[44px] gap-1.5 text-xs"
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
			)}
		</>
	)
}

function MissingIngredientActions({
	ingredientId,
	recipeId,
	ratio,
	useMetric,
	onMarkedHave,
}: {
	ingredientId: string
	recipeId: string
	ratio: number
	useMetric?: boolean
	onMarkedHave: (id: string) => void
}) {
	const haveFetcher = useFetcher()
	const cartFetcher = useFetcher()

	const cartData = cartFetcher.data as
		| { addedSingle?: string; wasNew?: boolean }
		| undefined
	const addedToCart = cartData?.addedSingle === ingredientId

	return (
		<span
			className="ml-auto flex shrink-0 items-center print:hidden"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="I have this"
						className="flex size-[44px] items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-primary"
						disabled={haveFetcher.state !== 'idle'}
						onClick={() => {
							onMarkedHave(ingredientId)
							haveFetcher.submit(
								{
									intent: 'mark-have-ingredient',
									ingredientId,
								},
								{
									method: 'POST',
									action: `/recipes/${recipeId}`,
								},
							)
						}}
					>
						<Icon name="file-text" className="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent>I have this</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="Add to shopping list"
						className={cn(
							'flex size-[44px] items-center justify-center rounded-md transition-colors',
							addedToCart
								? 'text-primary'
								: 'text-muted-foreground/50 hover:text-accent',
						)}
						disabled={cartFetcher.state !== 'idle' || addedToCart}
						onClick={() => {
							const formData = new FormData()
							formData.set('intent', 'add-single-to-shopping-list')
							formData.set('ingredientId', ingredientId)
							formData.set('servingRatio', ratio.toString())
							if (useMetric) {
								formData.set('useMetric', '1')
							}
							cartFetcher.submit(formData, {
								method: 'POST',
								action: `/recipes/${recipeId}`,
							})
						}}
					>
						<Icon
							name={addedToCart ? 'check' : 'cart'}
							className="size-4"
						/>
					</button>
				</TooltipTrigger>
				<TooltipContent>
					{addedToCart
						? cartData?.wasNew === false
							? 'Already on list'
							: 'Added!'
						: 'Add to shopping list'}
				</TooltipContent>
			</Tooltip>
		</span>
	)
}
