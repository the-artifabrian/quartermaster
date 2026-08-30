import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
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
	type TypedYield,
} from '#app/utils/target-yield.ts'

// PROTOTYPE: Three scaling-control variants on the existing Recipe detail route,
// switchable via `?scalePrototype=`, for local evaluation only.

const VARIANTS = [
	{ key: 'target', label: 'A — Target + equivalence' },
	{ key: 'multiplier', label: 'B — Multiplier first' },
	{ key: 'choice', label: 'C — Choose the language' },
] as const

type VariantKey = (typeof VARIANTS)[number]['key']

type RecipeScalePrototypeProps = {
	variant: VariantKey
	scaleMultiplier: number
	yieldAmount: number | null
	yieldLabel: string | null
	onScaleMultiplierChange: (scaleMultiplier: number) => void
}

export function isRecipeScalePrototypeVariant(
	value: string | null,
): value is VariantKey {
	return VARIANTS.some((variant) => variant.key === value)
}

export function RecipeScalePrototype({
	variant,
	scaleMultiplier,
	yieldAmount,
	yieldLabel,
	onScaleMultiplierChange,
}: RecipeScalePrototypeProps) {
	const storedYield = getTypedYield({ yieldAmount, yieldLabel })
	const recipeYield = storedYield ?? { amount: 4, label: 'portions' }

	const control = (() => {
		switch (variant) {
			case 'target':
				return (
					<TargetFirstVariant
						scaleMultiplier={scaleMultiplier}
						recipeYield={recipeYield}
						onScaleMultiplierChange={onScaleMultiplierChange}
					/>
				)
			case 'multiplier':
				return (
					<MultiplierFirstVariant
						scaleMultiplier={scaleMultiplier}
						recipeYield={recipeYield}
						onScaleMultiplierChange={onScaleMultiplierChange}
					/>
				)
			case 'choice':
				return (
					<ChoiceVariant
						scaleMultiplier={scaleMultiplier}
						recipeYield={recipeYield}
						onScaleMultiplierChange={onScaleMultiplierChange}
					/>
				)
		}
	})()

	return (
		<div className="flex flex-col items-end gap-0.5">
			{storedYield ? null : (
				<span className="text-accent-foreground bg-accent/10 rounded px-1.5 py-0.5 text-[0.65rem]">
					Simulated: 1× = 4 portions
				</span>
			)}
			{control}
		</div>
	)
}

function TargetFirstVariant({
	scaleMultiplier,
	recipeYield,
	onScaleMultiplierChange,
}: PrototypeVariantProps) {
	return (
		<div className="flex flex-col items-end gap-0.5">
			<div className="flex items-center gap-1.5">
				<span className="text-muted-foreground text-xs">Cook for</span>
				<PrototypeScaleInput
					mode="target"
					scaleMultiplier={scaleMultiplier}
					recipeYield={recipeYield}
					onScaleMultiplierChange={onScaleMultiplierChange}
					className="h-8 w-16 px-2 text-center"
				/>
				<span className="text-sm">{recipeYield.label}</span>
			</div>
			<p className="text-muted-foreground text-[0.7rem]">
				{formatTarget(recipeYield.amount)} {recipeYield.label} at 1× · now{' '}
				{formatScaleMultiplier(scaleMultiplier)}×
			</p>
		</div>
	)
}

function MultiplierFirstVariant({
	scaleMultiplier,
	recipeYield,
	onScaleMultiplierChange,
}: PrototypeVariantProps) {
	const currentTarget = scaleMultiplierToTargetYield(
		scaleMultiplier,
		recipeYield,
	)!
	const presets = [0.5, 1, 2]

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="flex items-center gap-1">
				{presets.map((preset) => (
					<button
						key={preset}
						type="button"
						onClick={() => onScaleMultiplierChange(preset)}
						className={cn(
							'border-input hover:border-primary/50 h-8 rounded-md border px-2 text-xs tabular-nums',
							scaleMultiplier === preset &&
								'border-primary bg-primary/5 text-primary',
						)}
					>
						{formatScaleMultiplier(preset)}×
					</button>
				))}
				<PrototypeScaleInput
					mode="multiplier"
					scaleMultiplier={scaleMultiplier}
					recipeYield={recipeYield}
					onScaleMultiplierChange={onScaleMultiplierChange}
					className="h-8 w-14 px-1.5 text-center"
				/>
				<span className="text-sm">×</span>
			</div>
			<p className="text-muted-foreground text-[0.7rem]">
				About {formatTarget(currentTarget)} {recipeYield.label} (recipe says{' '}
				{formatTarget(recipeYield.amount)} at 1×)
			</p>
		</div>
	)
}

function ChoiceVariant({
	scaleMultiplier,
	recipeYield,
	onScaleMultiplierChange,
}: PrototypeVariantProps) {
	const [mode, setMode] = useState<'target' | 'multiplier'>('target')
	const currentTarget = scaleMultiplierToTargetYield(
		scaleMultiplier,
		recipeYield,
	)!

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="border-input flex rounded-md border p-0.5 text-xs">
				<button
					type="button"
					onClick={() => setMode('target')}
					className={cn(
						'rounded-sm px-2 py-1',
						mode === 'target' && 'bg-foreground text-background',
					)}
				>
					Yield
				</button>
				<button
					type="button"
					onClick={() => setMode('multiplier')}
					className={cn(
						'rounded-sm px-2 py-1',
						mode === 'multiplier' && 'bg-foreground text-background',
					)}
				>
					Multiplier
				</button>
			</div>
			<div className="flex items-center gap-1.5">
				<PrototypeScaleInput
					mode={mode}
					scaleMultiplier={scaleMultiplier}
					recipeYield={recipeYield}
					onScaleMultiplierChange={onScaleMultiplierChange}
					className="h-8 w-16 px-2 text-center"
				/>
				<span className="text-sm">
					{mode === 'target' ? recipeYield.label : '×'}
				</span>
			</div>
			<p className="text-muted-foreground text-[0.7rem]">
				{formatTarget(currentTarget)} {recipeYield.label} ={' '}
				{formatScaleMultiplier(scaleMultiplier)}×
			</p>
		</div>
	)
}

type PrototypeVariantProps = {
	scaleMultiplier: number
	recipeYield: TypedYield
	onScaleMultiplierChange: (scaleMultiplier: number) => void
}

function PrototypeScaleInput({
	mode,
	scaleMultiplier,
	recipeYield,
	onScaleMultiplierChange,
	className,
}: PrototypeVariantProps & {
	mode: 'target' | 'multiplier'
	className?: string
}) {
	const displayedValue =
		mode === 'target'
			? formatTarget(
					scaleMultiplierToTargetYield(scaleMultiplier, recipeYield)!,
				)
			: formatScaleMultiplier(scaleMultiplier)
	const [draft, setDraft] = useState(displayedValue)
	const [invalid, setInvalid] = useState(false)

	useEffect(() => {
		setDraft(displayedValue)
		setInvalid(false)
	}, [displayedValue, mode])

	function commit() {
		const parsed =
			mode === 'target'
				? TargetYieldSchema.safeParse(draft)
				: ScaleMultiplierSchema.safeParse(draft)
		if (!parsed.success) {
			setInvalid(true)
			return
		}
		const nextMultiplier =
			mode === 'target'
				? targetYieldToScaleMultiplier(parsed.data, recipeYield)
				: parsed.data
		if (nextMultiplier == null) {
			setInvalid(true)
			return
		}
		setInvalid(false)
		onScaleMultiplierChange(nextMultiplier)
	}

	return (
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
			aria-label={mode === 'target' ? 'Target yield' : 'Scale multiplier'}
			aria-invalid={invalid || undefined}
			className={cn(
				'tabular-nums',
				invalid && 'border-destructive focus-visible:ring-destructive',
				className,
			)}
		/>
	)
}

function formatTarget(value: number) {
	return formatTargetYieldAmount(value)
}

export function RecipeScalePrototypeSwitcher({
	current,
}: {
	current: VariantKey
}) {
	const [, setSearchParams] = useSearchParams()
	const currentIndex = VARIANTS.findIndex((variant) => variant.key === current)

	function select(offset: number) {
		const nextIndex =
			(currentIndex + offset + VARIANTS.length) % VARIANTS.length
		setSearchParams(
			(params) => {
				params.set('scalePrototype', VARIANTS[nextIndex]!.key)
				return params
			},
			{ replace: true },
		)
	}

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return
			}
			if (event.key === 'ArrowLeft') select(-1)
			if (event.key === 'ArrowRight') select(1)
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	})

	return (
		<div className="bg-foreground text-background fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1.5 shadow-xl md:bottom-4">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => select(-1)}
				aria-label="Previous scaling prototype"
				className="hover:bg-background/15 h-8 px-2 hover:text-current"
			>
				←
			</Button>
			<span className="min-w-48 text-center text-xs font-medium">
				Prototype · {VARIANTS[currentIndex]!.label}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => select(1)}
				aria-label="Next scaling prototype"
				className="hover:bg-background/15 h-8 px-2 hover:text-current"
			>
				→
			</Button>
		</div>
	)
}
