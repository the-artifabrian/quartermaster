import { useEffect, useId, useState } from 'react'
import { Input } from '#app/components/ui/input.tsx'
import {
	formatScaleMultiplier,
	ScaleMultiplierSchema,
	TargetYieldSchema,
} from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import {
	formatTargetYieldAmount,
	getTypedYield,
	scaleMultiplierToTargetYield,
	targetYieldToScaleMultiplier,
} from '#app/utils/target-yield.ts'

type RecipeScaleControlProps = {
	scaleMultiplier: number
	yieldAmount: number | null
	yieldLabel: string | null
	onScaleMultiplierChange: (scaleMultiplier: number) => void
	compact?: boolean
}

/**
 * One-Recipe quantity control. Typed yield changes only the friendly input;
 * callers still receive and persist a positive batch multiplier.
 */
export function RecipeScaleControl({
	scaleMultiplier,
	yieldAmount,
	yieldLabel,
	onScaleMultiplierChange,
	compact = false,
}: RecipeScaleControlProps) {
	const recipeYield = getTypedYield({ yieldAmount, yieldLabel })
	const displayedValue = recipeYield
		? formatTargetYieldAmount(
				scaleMultiplierToTargetYield(scaleMultiplier, recipeYield)!,
			)
		: formatScaleMultiplier(scaleMultiplier)
	const [draft, setDraft] = useState(displayedValue)
	const [invalid, setInvalid] = useState(false)
	const equivalenceId = useId()
	const equivalenceMultiplier =
		recipeYield && scaleMultiplier !== 1
			? formatScaleMultiplier(scaleMultiplier)
			: null
	const inputLabel = recipeYield
		? `Target ${recipeYield.label}`
		: 'Scale multiplier'

	useEffect(() => {
		setDraft(displayedValue)
		setInvalid(false)
	}, [displayedValue])

	function commit() {
		if (draft.trim() === displayedValue) {
			setInvalid(false)
			return
		}
		const nextMultiplier = recipeYield
			? (() => {
					const parsed = TargetYieldSchema.safeParse(draft)
					return parsed.success
						? targetYieldToScaleMultiplier(parsed.data, recipeYield)
						: null
				})()
			: (() => {
					const parsed = ScaleMultiplierSchema.safeParse(draft)
					return parsed.success ? parsed.data : null
				})()
		if (nextMultiplier == null) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		onScaleMultiplierChange(nextMultiplier)
	}

	return (
		<label className="flex min-w-0 items-center gap-1.5">
			<span className="sr-only">{inputLabel}</span>
			{recipeYield && !compact ? (
				<span aria-hidden="true" className="text-muted-foreground text-xs">
					Target
				</span>
			) : null}
			<Input
				type="text"
				inputMode="decimal"
				value={draft}
				onChange={(event) => {
					setDraft(event.target.value)
					setInvalid(false)
				}}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault()
						commit()
					}
				}}
				aria-label={inputLabel}
				aria-describedby={equivalenceMultiplier ? equivalenceId : undefined}
				aria-invalid={invalid || undefined}
				className={cn(
					'text-center tabular-nums',
					compact ? 'h-7 w-16 px-1.5 text-xs' : 'h-8 w-20 px-2 text-sm',
					invalid && 'border-destructive focus-visible:ring-destructive',
				)}
			/>
			<span
				aria-hidden="true"
				className={cn(
					'text-muted-foreground min-w-0 truncate',
					compact ? 'max-w-24 text-xs' : 'max-w-40 text-sm',
				)}
			>
				{recipeYield?.label ?? '×'}
			</span>
			{equivalenceMultiplier ? (
				<>
					<span id={equivalenceId} className="sr-only">
						{equivalenceMultiplier} times recipe
					</span>
					<span
						aria-hidden="true"
						className={cn(
							'text-muted-foreground shrink-0 tabular-nums',
							compact ? 'text-xs' : 'text-sm',
						)}
					>
						· {equivalenceMultiplier}×
					</span>
				</>
			) : null}
		</label>
	)
}
