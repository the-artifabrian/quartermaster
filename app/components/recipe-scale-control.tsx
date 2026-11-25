import { type RefObject, useEffect, useRef, useState } from 'react'
import { BottomSheet, opensAsSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Button } from '#app/components/ui/button.tsx'
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
import { scaledYieldLabel } from '#app/utils/ingredient-plural.ts'
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
	/** Filled with a function that saves the typed multiplier now. */
	commitRef?: RefObject<(() => void) | null>
}

/**
 * The shared multiplier editor. Recipe pages place the full editor in a
 * popover; compact Meal controls keep the direct input.
 */
export function RecipeScaleControl({
	scaleMultiplier,
	onScaleMultiplierChange,
	compact = false,
	commitRef,
}: RecipeScaleControlProps) {
	const displayedValue = formatScaleMultiplier(scaleMultiplier)
	const [draft, setDraft] = useState(displayedValue)
	// The draft last sent. Closing Scale's sheet saves it and the field may
	// blur straight after, before the parent has taken the value: that blur
	// must not send it again. Editing the draft clears it.
	const sentDraft = useRef<string | null>(null)

	useEffect(() => {
		setDraft(displayedValue)
	}, [displayedValue])

	function commit() {
		if (draft.trim() === displayedValue) return
		if (draft === sentDraft.current) return
		const parsed = ScaleMultiplierSchema.safeParse(draft)
		// "1.0" on a 1× Recipe saves nothing, so show the saved form again.
		if (!parsed.success || parsed.data === scaleMultiplier) {
			setDraft(displayedValue)
			return
		}
		sentDraft.current = draft
		onScaleMultiplierChange(parsed.data)
	}
	useEffect(() => {
		if (commitRef) commitRef.current = commit
	})

	function adjustScale(delta: number) {
		const nextMultiplier = Math.round((scaleMultiplier + delta) * 100) / 100
		if (nextMultiplier <= 0 || nextMultiplier > 100) return
		onScaleMultiplierChange(nextMultiplier)
	}

	const input = (
		<label
			className={cn(
				'flex items-center gap-1',
				// The compact field is a quiet 28px fill to the eye, the × inside
				// it; the label around it is 44px to the thumb (a tap on it
				// focuses the field). The field sits above that area, so a tap in
				// it still places the caret.
				compact &&
					"bg-muted/70 focus-within:ring-ring/40 desktop:before:hidden relative h-7 min-w-11 shrink-0 justify-center gap-0.5 rounded-md pr-2 pl-1.5 before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] focus-within:ring-2",
			)}
		>
			<span className="sr-only">Scale multiplier</span>
			<Input
				type="text"
				inputMode="decimal"
				enterKeyHint="done"
				value={draft}
				onChange={(event) => {
					if (!isAllowedScaleDraft(event.target.value)) return
					sentDraft.current = null
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
					compact
						? cn(
								'relative z-1 h-7 border-0 bg-transparent px-0 text-center text-xs focus-visible:ring-0 focus-visible:ring-offset-0 md:text-xs',
								// 1× is the usual; a scaled Recipe reads in ink.
								draft.trim() === '1' && 'text-muted-foreground',
							)
						: 'h-11 w-20 px-2 text-base',
				)}
				// Sized to the value: a phone forces inputs to 16px, where a fixed
				// width clipped "99.75". Digits are tabular, one ch each.
				style={
					compact
						? { width: `calc(${Math.max(draft.length, 2)}ch + 2px)` }
						: undefined
				}
			/>
			<span
				aria-hidden="true"
				className={cn(
					'text-muted-foreground',
					compact
						? 'pointer-events-none relative z-1 text-sm md:text-xs'
						: 'text-sm',
				)}
			>
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
	const derivedTarget = scaleMultiplierToTargetYield(
		scaleMultiplier,
		recipeYield,
	)
	const formattedTargetYield =
		derivedTarget != null ? formatTargetYieldAmount(derivedTarget) : null
	// "Makes 2 loaves", not "2 loaf".
	const targetYieldLabel =
		derivedTarget != null && recipeYield
			? scaledYieldLabel(recipeYield.label, derivedTarget, scaleMultiplier)
			: null
	const displayedMultiplier = formatScaleMultiplier(scaleMultiplier)
	// A popover on wider screens, a bottom sheet on a phone (set on open).
	const [open, setOpen] = useState(false)
	const [inSheet, setInSheet] = useState(false)
	// The multiplier field saves on blur or Enter. On iOS a tap on a button
	// does not blur it, nor does closing the sheet, so closing saves it.
	const commitRef = useRef<(() => void) | null>(null)
	function closeSheet() {
		commitRef.current?.()
		setOpen(false)
	}

	const scaleEditor = (
		<>
			<RecipeScaleControl
				scaleMultiplier={scaleMultiplier}
				yieldAmount={yieldAmount}
				yieldLabel={yieldLabel}
				onScaleMultiplierChange={onScaleMultiplierChange}
				commitRef={commitRef}
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
		</>
	)

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
					{/* The chevron trails, so the heading starts on the content edge
					    like Instructions. */}
					<h2 className="font-serif text-lg font-normal">Ingredients</h2>
					<Icon
						name="chevron-down"
						size="sm"
						aria-hidden="true"
						className={cn(
							'text-muted-foreground shrink-0 transition-transform',
							!ingredientsExpanded && '-rotate-90',
						)}
					/>
				</button>
				<h2 className="hidden font-serif text-lg font-normal lg:block print:block">
					Ingredients
				</h2>

				<Popover
					open={open && !inSheet}
					onOpenChange={(nextOpen) => {
						if (nextOpen) setInSheet(opensAsSheet())
						setOpen(nextOpen)
					}}
				>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={`Scale ${displayedMultiplier}×`}
							// Radix reports its own state, which is closed while the
							// sheet stands in for the popover.
							aria-expanded={open}
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
						<p className="mb-2 text-sm font-medium">Scale this Recipe</p>
						{scaleEditor}
					</PopoverContent>
				</Popover>
				{inSheet && (
					<BottomSheet
						open={open}
						onClose={closeSheet}
						labelledBy="recipe-scale-sheet-title"
						title="Scale this Recipe"
					>
						{scaleEditor}
						<Button type="button" className="mt-4 w-full" onClick={closeSheet}>
							Done
						</Button>
					</BottomSheet>
				)}

				{onToggleMetric ? (
					<button
						type="button"
						onClick={onToggleMetric}
						aria-pressed={useMetric}
						className="focus-visible:ring-ring focus-visible:ring-offset-background group/metric flex min-h-11 shrink-0 items-center rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden print:hidden"
					>
						{/* The pill is 32px tall; the button keeps the 44px target */}
						<span
							className={cn(
								'flex h-8 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
								useMetric
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border/50 bg-secondary/50 text-muted-foreground group-hover/metric:bg-secondary group-hover/metric:text-foreground',
							)}
						>
							Metric
						</span>
					</button>
				) : null}
			</div>

			{formattedTargetYield != null && recipeYield ? (
				<p
					aria-live="polite"
					className="text-muted-foreground min-w-0 text-xs leading-relaxed break-words print:hidden"
				>
					<span>
						Makes {formattedTargetYield} {targetYieldLabel}
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
