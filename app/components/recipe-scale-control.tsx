import { useEffect, useState } from 'react'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '#app/components/ui/popover.tsx'
import {
	formatScaleMultiplier,
	ScaleMultiplierSchema,
} from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
} from '#app/utils/target-yield.ts'

const SCALE_STEP = 0.5
const SCALE_DRAFT_PATTERN = /^(?:0|[1-9]\d{0,2})?(?:[.,]\d{0,2})?$/

function isAllowedScaleDraft(value: string) {
	if (!SCALE_DRAFT_PATTERN.test(value)) return false
	if (value === '' || value.endsWith('.') || value.endsWith(',')) return true
	return Number(value.replace(',', '.')) <= 100
}

type RecipeScaleControlProps = {
	scaleMultiplier: number
	yieldAmount: number | null
	yieldLabel: string | null
	onScaleMultiplierChange: (scaleMultiplier: number) => void
	compact?: boolean
}

/**
 * The shared multiplier editor. Recipe pages place the full editor in a
 * popover; compact Meal controls keep the direct input.
 */
export function RecipeScaleControl({
	scaleMultiplier,
	onScaleMultiplierChange,
	compact = false,
}: RecipeScaleControlProps) {
	const displayedValue = formatScaleMultiplier(scaleMultiplier)
	const [draft, setDraft] = useState(displayedValue)

	useEffect(() => {
		setDraft(displayedValue)
	}, [displayedValue])

	function commit() {
		if (draft.trim() === displayedValue) return
		const parsed = ScaleMultiplierSchema.safeParse(draft)
		if (!parsed.success) {
			setDraft(displayedValue)
			return
		}
		onScaleMultiplierChange(parsed.data)
	}

	function adjustScale(delta: number) {
		const nextMultiplier = Math.round((scaleMultiplier + delta) * 100) / 100
		if (nextMultiplier <= 0 || nextMultiplier > 100) return
		onScaleMultiplierChange(nextMultiplier)
	}

	const input = (
		<label className="flex items-center gap-1">
			<span className="sr-only">Scale multiplier</span>
			<Input
				type="text"
				inputMode="decimal"
				value={draft}
				onChange={(event) => {
					if (!isAllowedScaleDraft(event.target.value)) return
					setDraft(event.target.value)
				}}
				maxLength={6}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault()
						commit()
					}
				}}
				aria-label="Scale multiplier"
				className={cn(
					'text-center tabular-nums',
					compact ? 'h-7 w-16 px-1.5 text-xs' : 'h-11 w-20 px-2 text-base',
				)}
			/>
			<span aria-hidden="true" className="text-muted-foreground text-sm">
				×
			</span>
		</label>
	)

	if (compact) return input

	return (
		<div
			role="group"
			aria-label="Recipe scale controls"
			className="flex items-center justify-center gap-2"
		>
			<button
				type="button"
				aria-label="Decrease recipe scale"
				disabled={scaleMultiplier <= SCALE_STEP}
				onClick={() => adjustScale(-SCALE_STEP)}
				className="border-input hover:bg-accent/10 focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md border text-xl leading-none focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40"
			>
				−
			</button>
			{input}
			<button
				type="button"
				aria-label="Increase recipe scale"
				disabled={scaleMultiplier >= 100}
				onClick={() => adjustScale(SCALE_STEP)}
				className="border-input hover:bg-accent/10 focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md border text-xl leading-none focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40"
			>
				+
			</button>
		</div>
	)
}

type RecipeIngredientsControlsProps = RecipeScaleControlProps & {
	ingredientsExpanded: boolean
	onToggleIngredients: () => void
	useMetric?: boolean
	onToggleMetric?: () => void
}

/**
 * Recipe-page Ingredients heading. Scaling reads as quiet recipe context at
 * rest and reveals the precise editor on demand.
 */
export function RecipeIngredientsControls({
	scaleMultiplier,
	yieldAmount,
	yieldLabel,
	onScaleMultiplierChange,
	ingredientsExpanded,
	onToggleIngredients,
	useMetric,
	onToggleMetric,
}: RecipeIngredientsControlsProps) {
	const recipeYield = getTypedYield({ yieldAmount, yieldLabel })
	const targetYield = scaleMultiplierToTargetYield(scaleMultiplier, recipeYield)
	const formattedTargetYield =
		targetYield != null ? formatTargetYieldAmount(targetYield) : null
	const displayedMultiplier = formatScaleMultiplier(scaleMultiplier)

	return (
		<div className="mb-4 min-w-0">
			<div className="flex min-w-0 items-center gap-1">
				<button
					type="button"
					aria-label="Ingredients"
					className="focus-visible:ring-ring flex min-h-11 min-w-0 items-center gap-1.5 rounded-sm pr-1 focus-visible:ring-2 focus-visible:outline-hidden lg:hidden print:hidden"
					onClick={onToggleIngredients}
					aria-expanded={ingredientsExpanded}
					aria-controls="ingredients-list"
				>
					<Icon
						name="chevron-down"
						size="sm"
						aria-hidden="true"
						className={cn(
							'text-muted-foreground shrink-0 transition-transform',
							!ingredientsExpanded && '-rotate-90',
						)}
					/>
					<h2 className="font-serif text-lg font-normal">Ingredients</h2>
				</button>
				<h2 className="hidden font-serif text-lg font-normal lg:block print:block">
					Ingredients
				</h2>

				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={`Scale ${displayedMultiplier}×`}
							className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-hidden print:hidden"
						>
							<span>Scale</span>
							<span className="text-foreground tabular-nums">
								{displayedMultiplier}×
							</span>
							<Icon name="chevron-down" size="xs" aria-hidden="true" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-64 p-3">
						<p className="mb-2 text-sm font-medium">Scale this recipe</p>
						<RecipeScaleControl
							scaleMultiplier={scaleMultiplier}
							yieldAmount={yieldAmount}
							yieldLabel={yieldLabel}
							onScaleMultiplierChange={onScaleMultiplierChange}
						/>
						{scaleMultiplier !== 1 ? (
							<button
								type="button"
								onClick={() => onScaleMultiplierChange(1)}
								className="text-primary hover:bg-accent/10 focus-visible:ring-ring mt-2 min-h-11 w-full rounded-md px-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-hidden"
							>
								Original 1×
							</button>
						) : null}
					</PopoverContent>
				</Popover>

				{onToggleMetric ? (
					<button
						type="button"
						onClick={onToggleMetric}
						aria-pressed={useMetric}
						className={cn(
							'focus-visible:ring-ring min-h-11 shrink-0 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-hidden print:hidden',
							useMetric
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:text-foreground',
						)}
					>
						Metric
					</button>
				) : null}
			</div>

			{formattedTargetYield != null && recipeYield ? (
				<p
					aria-live="polite"
					className="text-muted-foreground min-w-0 pl-0 text-xs leading-relaxed break-words max-lg:pl-[1.375rem] print:hidden"
				>
					<span>
						Makes {formattedTargetYield} {recipeYield.label}
					</span>
					{scaleMultiplier !== 1 ? (
						<span>
							<span aria-hidden="true"> · </span>
							<span>
								original: {formatTargetYieldAmount(recipeYield.amount)}
							</span>
						</span>
					) : null}
				</p>
			) : null}
		</div>
	)
}
