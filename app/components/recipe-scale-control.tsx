import { useEffect, useState } from 'react'
import { Input } from '#app/components/ui/input.tsx'
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

type RecipeScaleControlProps = {
	scaleMultiplier: number
	yieldAmount: number | null
	yieldLabel: string | null
	onScaleMultiplierChange: (scaleMultiplier: number) => void
	compact?: boolean
}

/**
 * One-Recipe quantity control. The multiplier is always the interaction and
 * storage vocabulary; typed yield is optional explanatory context.
 */
export function RecipeScaleControl({
	scaleMultiplier,
	yieldAmount,
	yieldLabel,
	onScaleMultiplierChange,
	compact = false,
}: RecipeScaleControlProps) {
	const recipeYield = getTypedYield({ yieldAmount, yieldLabel })
	const displayedValue = formatScaleMultiplier(scaleMultiplier)
	const [draft, setDraft] = useState(displayedValue)
	const [invalid, setInvalid] = useState(false)
	const targetYield = scaleMultiplierToTargetYield(scaleMultiplier, recipeYield)
	const formattedTargetYield =
		targetYield != null ? formatTargetYieldAmount(targetYield) : null

	useEffect(() => {
		setDraft(displayedValue)
		setInvalid(false)
	}, [displayedValue])

	function commit() {
		if (draft.trim() === displayedValue) {
			setInvalid(false)
			return
		}
		const parsed = ScaleMultiplierSchema.safeParse(draft)
		const nextMultiplier = parsed.success ? parsed.data : null
		if (nextMultiplier == null) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		onScaleMultiplierChange(nextMultiplier)
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
				aria-label="Scale multiplier"
				aria-invalid={invalid || undefined}
				className={cn(
					'text-center tabular-nums',
					compact ? 'h-7 w-16 px-1.5 text-xs' : 'h-10 w-20 px-2 text-base',
					invalid && 'border-destructive focus-visible:ring-destructive',
				)}
			/>
			<span aria-hidden="true" className="text-muted-foreground text-sm">
				×
			</span>
		</label>
	)

	if (compact) return input

	return (
		<div className="min-w-0 print:hidden">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<span className="text-muted-foreground text-sm">Scale</span>
				<div
					role="group"
					aria-label="Recipe scale controls"
					className="flex items-center gap-2"
				>
					<button
						type="button"
						aria-label="Decrease recipe scale"
						disabled={scaleMultiplier <= SCALE_STEP}
						onClick={() => adjustScale(-SCALE_STEP)}
						className="border-input bg-background hover:bg-accent/10 focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-md border text-xl leading-none focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40"
					>
						−
					</button>
					{input}
					<button
						type="button"
						aria-label="Increase recipe scale"
						disabled={scaleMultiplier >= 100}
						onClick={() => adjustScale(SCALE_STEP)}
						className="border-input bg-background hover:bg-accent/10 focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-md border text-xl leading-none focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40"
					>
						+
					</button>
				</div>
			</div>
			{formattedTargetYield != null || scaleMultiplier !== 1 ? (
				<div className="mt-1.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					{formattedTargetYield != null && recipeYield ? (
						<p
							aria-live="polite"
							className="text-muted-foreground min-w-0 text-sm break-words"
						>
							<span>
								Makes {formattedTargetYield} {recipeYield.label}
							</span>
							{scaleMultiplier !== 1 ? (
								<span className="text-muted-foreground">
									<span aria-hidden="true"> · </span>
									<span>
										originally {formatTargetYieldAmount(recipeYield.amount)}{' '}
										{recipeYield.label}
									</span>
								</span>
							) : null}
						</p>
					) : (
						<span />
					)}
					{scaleMultiplier !== 1 ? (
						<button
							type="button"
							onClick={() => onScaleMultiplierChange(1)}
							className="text-primary min-h-10 shrink-0 text-sm font-medium hover:underline"
						>
							Back to 1×
						</button>
					) : null}
				</div>
			) : null}
		</div>
	)
}
