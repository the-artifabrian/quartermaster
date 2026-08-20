import { useEffect, useMemo, useState } from 'react'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	type QuantityClarification,
	type QuantityProposal,
	type QuantitySelection,
} from '#app/utils/meal-quantity-proposal.server.ts'
import { formatScaleMultiplier } from '#app/utils/menu-validation.ts'
import { cn } from '#app/utils/misc.tsx'

export type QuantityReviewItem = {
	itemKey: string
	title: string
	currentScaleMultiplier: number
}

function parseMultiplier(value: string) {
	const trimmed = value.trim()
	if (!/^\d{1,3}([.,]\d{1,2})?$/.test(trimmed)) return null
	const parsed = Number(trimmed.replace(',', '.'))
	return parsed > 0 && parsed <= 100 ? parsed : null
}

export function MealQuantityReview({
	proposal,
	items,
	busy,
	applyLabel = 'Apply selected',
	onApply,
	onUpdateDefaults,
	onRerun,
	onCancel,
}: {
	proposal: QuantityProposal
	items: QuantityReviewItem[]
	busy: boolean
	applyLabel?: string
	onApply: (selections: QuantitySelection[]) => void
	onUpdateDefaults?: (selections: QuantitySelection[]) => void
	onRerun: () => void
	onCancel: () => void
}) {
	const [review, setReview] = useState(() => initialReview(proposal))
	useEffect(() => setReview(initialReview(proposal)), [proposal])

	const itemDetails = useMemo(
		() => new Map(items.map((item) => [item.itemKey, item])),
		[items],
	)
	const selections = proposal.items.flatMap<QuantitySelection>((item) => {
		const state = review[item.itemKey]
		const scaleMultiplier = state ? parseMultiplier(state.value) : null
		return state?.selected && scaleMultiplier != null
			? [{ itemKey: item.itemKey, scaleMultiplier }]
			: []
	})
	const hasInvalidSelected = proposal.items.some((item) => {
		const state = review[item.itemKey]
		return state?.selected && parseMultiplier(state.value) == null
	})

	return (
		<div className="space-y-3">
			<div>
				<h3 className="flex items-center gap-1.5 font-serif text-base">
					<Icon name="sparkles" className="text-accent size-4" />
					Review quantity proposal
				</h3>
				<p className="text-muted-foreground mt-0.5 text-xs">
					Select, edit, or reject every Recipe. Nothing changes until you
					explicitly apply.
				</p>
			</div>

			{proposal.assumptions.length > 0 ? (
				<div className="border-border/60 bg-muted/30 rounded-md border px-3 py-2">
					<p className="text-xs font-medium">Meal assumptions</p>
					<ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4 text-xs">
						{proposal.assumptions.map((assumption) => (
							<li key={assumption}>{assumption}</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="space-y-2">
				{proposal.items.map((proposalItem) => {
					const item = itemDetails.get(proposalItem.itemKey)
					if (!item) return null
					const state = review[proposalItem.itemKey]!
					const invalid = state.selected && parseMultiplier(state.value) == null
					return (
						<div
							key={proposalItem.itemKey}
							className={cn(
								'border-border/60 rounded-md border p-3',
								!state.selected && 'bg-muted/20 opacity-75',
							)}
						>
							<div className="flex items-start gap-2.5">
								<input
									type="checkbox"
									checked={state.selected}
									onChange={(event) =>
										setReview((current) => ({
											...current,
											[proposalItem.itemKey]: {
												...current[proposalItem.itemKey]!,
												selected: event.target.checked,
											},
										}))
									}
									aria-label={`Use proposed quantity for ${item.title}`}
									className="mt-1 size-4 shrink-0 rounded"
								/>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-baseline justify-between gap-1">
										<p className="font-serif text-sm">{item.title}</p>
										<span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
											{proposalItem.scalingMode.replace('-', ' ')}
										</span>
									</div>
									<p className="text-muted-foreground mt-0.5 text-xs">
										Current {formatScaleMultiplier(item.currentScaleMultiplier)}
										× · {proposalItem.rationale}
									</p>
									{proposalItem.assumptions.length > 0 ? (
										<ul className="text-muted-foreground mt-1 list-disc pl-4 text-[11px]">
											{proposalItem.assumptions.map((assumption) => (
												<li key={assumption}>{assumption}</li>
											))}
										</ul>
									) : null}
									<div className="mt-2 flex items-center gap-2">
										<label
											htmlFor={`quantity-${proposalItem.itemKey}`}
											className="text-xs font-medium"
										>
											Multiplier
										</label>
										<Input
											id={`quantity-${proposalItem.itemKey}`}
											inputMode="decimal"
											value={state.value}
											disabled={!state.selected}
											onChange={(event) =>
												setReview((current) => ({
													...current,
													[proposalItem.itemKey]: {
														...current[proposalItem.itemKey]!,
														value: event.target.value,
													},
												}))
											}
											aria-invalid={invalid || undefined}
											className={cn(
												'h-8 w-20',
												invalid && 'border-destructive',
											)}
										/>
										<span className="text-muted-foreground text-xs">×</span>
										{invalid ? (
											<span className="text-destructive text-xs">
												Use 0.01–100, up to two decimals
											</span>
										) : null}
									</div>
								</div>
							</div>
						</div>
					)
				})}
			</div>

			<p className="text-muted-foreground text-xs">
				Apply selected changes only this Meal. Updating Menu defaults is a
				separate explicit action.
			</p>
			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onRerun}
					disabled={busy}
				>
					<Icon name="update" size="sm" />
					Re-run
				</Button>
				{onUpdateDefaults ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onUpdateDefaults(selections)}
						disabled={busy || selections.length === 0 || hasInvalidSelected}
					>
						Update Menu defaults
					</Button>
				) : null}
				<Button
					type="button"
					size="sm"
					onClick={() => onApply(selections)}
					disabled={busy || selections.length === 0 || hasInvalidSelected}
				>
					{busy ? 'Applying…' : applyLabel}
				</Button>
			</div>
		</div>
	)
}

export function MealQuantityClarification({
	clarification,
	busy,
	onAnswer,
	onCancel,
}: {
	clarification: QuantityClarification
	busy: boolean
	onAnswer: (answer: string) => void
	onCancel: () => void
}) {
	const [answer, setAnswer] = useState(clarification.choices[0] ?? '')
	useEffect(() => {
		setAnswer(clarification.choices[0] ?? '')
	}, [clarification])

	return (
		<div className="space-y-3">
			<div>
				<h3 className="font-serif text-base">One clarification</h3>
				<p className="text-muted-foreground mt-1 text-sm">
					{clarification.question}
				</p>
			</div>
			<div className="space-y-2">
				{clarification.choices.map((choice) => (
					<label
						key={choice}
						className="border-border/60 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
					>
						<input
							type="radio"
							name="quantity-clarification"
							value={choice}
							checked={answer === choice}
							onChange={() => setAnswer(choice)}
						/>
						{choice}
					</label>
				))}
			</div>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={busy || !answer}
					onClick={() => onAnswer(answer)}
				>
					{busy ? 'Planning…' : 'Continue'}
				</Button>
			</div>
		</div>
	)
}

function initialReview(proposal: QuantityProposal) {
	return Object.fromEntries(
		proposal.items.map((item) => [
			item.itemKey,
			{
				selected: true,
				value: formatScaleMultiplier(item.scaleMultiplier),
			},
		]),
	) as Record<string, { selected: boolean; value: string }>
}
