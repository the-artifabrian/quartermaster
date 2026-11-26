import { useEffect } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'
import { scaleAmountKitchen } from '#app/utils/fractions.ts'
import { scaledLineWords } from '#app/utils/ingredient-plural.ts'
import {
	convertToMetric,
	formatMetricAmount,
} from '#app/utils/metric-conversion.ts'
import { cn } from '#app/utils/misc.tsx'
import { PushLink } from './push-link.tsx'

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
	recipeId,
	canAddToShopping = true,
	useMetric,
}: {
	ingredients: Array<IngredientListIngredient>
	checkedIngredients: Set<string>
	onToggle: (id: string) => void
	ratio: number
	recipeId: string
	/** False on the anonymous share page, which has no Shopping list. */
	canAddToShopping?: boolean
	useMetric?: boolean
}) {
	return (
		<>
			<ul className="space-y-1 leading-[1.7] print:columns-2 print:space-y-0 print:gap-x-6 print:text-sm print:leading-[1.5]">
				{ingredients.map((ingredient) => {
					if (ingredient.isHeading) {
						return (
							<li key={ingredient.id}>
								<p className="text-muted-foreground border-border/50 mt-4 mb-1.5 border-b pb-1 font-sans text-xs font-medium tracking-widest uppercase first:mt-0 print:mt-2 print:mb-0.5 print:break-inside-avoid-column print:px-0 print:text-[10px]">
									{ingredient.name}
								</p>
							</li>
						)
					}

					const isChecked = checkedIngredients.has(ingredient.id)
					// "2 eggs" and "2 pinches salt" once scaled, not "2 egg".
					const words = scaledLineWords(ingredient, ratio)

					return (
						<li
							key={ingredient.id}
							role="checkbox"
							aria-checked={isChecked}
							aria-label={ingredient.name}
							tabIndex={0}
							className={cn(
								// The checkbox sits on the content edge; the hover fill reaches past it.
								'-mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors select-none',
								// No fill under a checked row: its faint text needs the page.
								!isChecked && 'hover:bg-muted/50',
								'focus-visible:ring-primary/50 focus-visible:ring-2 focus-visible:outline-none',
								'print:mx-0 print:gap-1.5 print:rounded-none print:px-0 print:py-0.5',
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
										? 'border-primary-fill bg-primary-fill text-primary-foreground'
										: 'border-control-edge bg-muted/30',
								)}
							>
								{isChecked && <Icon name="check" className="size-4" />}
							</span>
							<span
								className={cn(
									'min-w-0 flex-1 transition-colors',
									isChecked && 'text-faint decoration-faint/60 line-through',
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
											{words.unit && <span>{words.unit} </span>}
										</>
									)
								})()}
								{ingredient.linkedRecipeId ? (
									<PushLink
										to={`/recipes/${ingredient.linkedRecipeId}`}
										className="text-primary decoration-primary/30 hover:decoration-primary/60 underline underline-offset-2"
										onClick={(e) => e.stopPropagation()}
									>
										{words.name}
									</PushLink>
								) : (
									<span>{words.name}</span>
								)}
								{ingredient.notes && (
									<span className={isChecked ? '' : 'text-muted-foreground'}>
										, {ingredient.notes}
									</span>
								)}
							</span>
							{/* A sub-Recipe row links to the Recipe that makes it; there
							    is nothing to buy under that one name. */}
							{canAddToShopping && !isChecked && !ingredient.linkedRecipeId && (
								<AddIngredientToShopping
									ingredientId={ingredient.id}
									recipeId={recipeId}
									ratio={ratio}
									useMetric={useMetric}
								/>
							)}
						</li>
					)
				})}
			</ul>
		</>
	)
}

/** Put one ingredient on the Shopping list, straight from the Recipe. */
function AddIngredientToShopping({
	ingredientId,
	recipeId,
	ratio,
	useMetric,
}: {
	ingredientId: string
	recipeId: string
	ratio: number
	useMetric?: boolean
}) {
	const cartFetcher = useFetcher()

	const cartData = cartFetcher.data as
		{ addedSingle?: string; wasNew?: boolean; error?: string } | undefined
	const addedToCart = cartData?.addedSingle === ingredientId
	// An ingredient another member removed meanwhile says so.
	const cartError = cartData?.error
	useEffect(() => {
		if (cartError) toast.error(cartError)
	}, [cartData, cartError])

	return (
		<span
			// The cart glyph ends on the content edge.
			className="-mr-3.5 ml-auto flex shrink-0 items-center print:hidden"
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="Add to Shopping"
						className={cn(
							'flex size-[44px] items-center justify-center rounded-md transition-colors',
							addedToCart
								? 'text-primary'
								: 'text-muted-foreground/70 hover:text-primary active:bg-muted active:text-primary',
						)}
						disabled={cartFetcher.state !== 'idle' || addedToCart}
						onClick={() => {
							const formData = new FormData()
							formData.set('intent', 'add-single-to-shopping-list')
							formData.set('ingredientId', ingredientId)
							formData.set('originClientId', getHouseholdClientId())
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
							? 'Already on Shopping'
							: 'Added to Shopping'
						: 'Add to Shopping'}
				</TooltipContent>
			</Tooltip>
		</span>
	)
}
