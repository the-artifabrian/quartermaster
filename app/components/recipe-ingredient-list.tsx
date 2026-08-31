import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'
import { scaleAmountKitchen } from '#app/utils/fractions.ts'
import {
	convertToMetric,
	formatMetricAmount,
} from '#app/utils/metric-conversion.ts'
import { cn } from '#app/utils/misc.tsx'

export type IngredientListIngredient = {
	id: string
	name: string
	amount: string | null
	unit: string | null
	notes: string | null
	isHeading: boolean
	linkedRecipeId?: string | null
	linkedRecipe?: { title: string } | null
}

export function IngredientList({
	ingredients,
	checkedIngredients,
	onToggle,
	ratio,
	missingIngredientIds,
	recipeId,
	canMarkUsuallyOnHand = true,
	useMetric,
}: {
	ingredients: Array<IngredientListIngredient>
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	missingIngredientIds: string[]
	recipeId: string
	canMarkUsuallyOnHand?: boolean
	useMetric?: boolean
}) {
	const [localHaveIds, setLocalHaveIds] = useState<Set<string>>(() => new Set())

	// Clear optimistic state when loader revalidates (server is now authoritative)
	const prevMissingRef = useRef(missingIngredientIds)
	useEffect(() => {
		if (prevMissingRef.current !== missingIngredientIds) {
			prevMissingRef.current = missingIngredientIds
			setLocalHaveIds(new Set())
		}
	}, [missingIngredientIds])

	const effectiveMissingIds = missingIngredientIds.filter(
		(id) => !localHaveIds.has(id),
	)
	const effectiveMissingSet = new Set(effectiveMissingIds)

	function handleMarkedHave(ingredientId: string) {
		setLocalHaveIds((prev) => new Set([...prev, ingredientId]))
	}

	return (
		<>
			<ul className="space-y-1 leading-[1.7] print:columns-2 print:space-y-0 print:gap-x-6 print:text-sm print:leading-[1.5]">
				{ingredients.map((ingredient) => {
					if (ingredient.isHeading) {
						return (
							<li key={ingredient.id}>
								<p className="text-muted-foreground border-border/50 mt-4 mb-1.5 border-b px-2 pb-1 font-sans text-xs font-medium tracking-widest uppercase first:mt-0 print:mt-2 print:mb-0.5 print:break-inside-avoid-column print:px-0 print:text-[10px]">
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
							aria-label={ingredient.name}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2.5 transition-colors select-none',
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
									isChecked &&
										'text-muted-foreground/40 decoration-muted-foreground/30 line-through',
								)}
							>
								{(() => {
									// Kitchen rounding (A5): scaled display values snap to
									// measurable quantities; ratio 1 keeps author precision.
									const kitchen = ingredient.amount
										? scaleAmountKitchen(
												ingredient.amount,
												ratio,
												ingredient.unit,
											)
										: null
									const metricResult =
										useMetric && kitchen?.value != null && ingredient.unit
											? convertToMetric(
													kitchen.value,
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
											{kitchen !== null && (
												<span className="font-medium">
													{kitchen.approximate ? '≈' : ''}
													{kitchen.display}{' '}
												</span>
											)}
											{ingredient.unit && <span>{ingredient.unit} </span>}
										</>
									)
								})()}
								{ingredient.linkedRecipeId ? (
									<Link
										to={`/recipes/${ingredient.linkedRecipeId}`}
										className="text-primary decoration-primary/30 hover:decoration-primary/60 underline underline-offset-2"
										onClick={(e) => e.stopPropagation()}
									>
										{ingredient.name}
									</Link>
								) : (
									<span>{ingredient.name}</span>
								)}
								{ingredient.notes && (
									<span className={isChecked ? '' : 'text-muted-foreground'}>
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
									canMarkUsuallyOnHand={canMarkUsuallyOnHand}
								/>
							)}
						</li>
					)
				})}
			</ul>
		</>
	)
}

function MissingIngredientActions({
	ingredientId,
	recipeId,
	ratio,
	useMetric,
	onMarkedHave,
	canMarkUsuallyOnHand,
}: {
	ingredientId: string
	recipeId: string
	ratio: number
	useMetric?: boolean
	onMarkedHave: (id: string) => void
	canMarkUsuallyOnHand: boolean
}) {
	const haveFetcher = useFetcher()
	const cartFetcher = useFetcher()

	const cartData = cartFetcher.data as
		{ addedSingle?: string; wasNew?: boolean } | undefined
	const addedToCart = cartData?.addedSingle === ingredientId

	return (
		<span
			className="ml-auto flex shrink-0 items-center print:hidden"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
		>
			{canMarkUsuallyOnHand && (
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Usually on hand"
							className="text-muted-foreground/50 hover:text-primary flex size-[44px] items-center justify-center rounded-md transition-colors"
							disabled={haveFetcher.state !== 'idle'}
							onClick={() => {
								onMarkedHave(ingredientId)
								void haveFetcher.submit(
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
					<TooltipContent>Usually on hand</TooltipContent>
				</Tooltip>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="Add to shopping list"
						className={cn(
							'flex size-[44px] items-center justify-center rounded-md transition-colors',
							addedToCart
								? 'text-primary'
								: 'text-muted-foreground/50 hover:text-primary',
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
							void cartFetcher.submit(formData, {
								method: 'POST',
								action: `/recipes/${recipeId}`,
							})
						}}
					>
						<Icon name={addedToCart ? 'check' : 'cart'} className="size-4" />
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
