// The rows and controls inside each Shopping horizon.
import { Fragment, type ReactNode, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { ShoppingListItemCard } from '#app/components/shopping-list-item.tsx'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { RowCollapse } from '#app/components/ui/row-collapse.tsx'
import {
	useDeleteWithUndo,
	useEnteringRows,
	useHiddenRows,
} from '#app/components/undo-delete.tsx'
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import { type useShoppingChecks } from '#app/hooks/use-shopping-checks.tsx'
import { HouseholdClientInput } from '#app/utils/household-client.tsx'
import { LATER, type ShoppingHorizon } from '#app/utils/shopping-horizon.ts'
import { cn } from '#app/utils/misc.tsx'
import { type PlacedRow } from '#app/utils/shopping-check-order.ts'
import { type DisplayShoppingItem } from '#app/utils/shopping-optimistic.ts'

export function LaterQuickAdd() {
	const fetcher = useFetcher<Record<string, unknown>>()
	const [name, setName] = useState('')
	const [warningDismissed, setWarningDismissed] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	useFetcherSettled(fetcher, (data) => {
		if (data?.status === 'success') {
			setName('')
			setWarningDismissed(false)
			inputRef.current?.focus()
		}
	})

	const warningData =
		fetcher.data &&
		'warningType' in fetcher.data &&
		fetcher.data.status === 'warning'
			? fetcher.data
			: null
	const showWarning = !warningDismissed && warningData != null
	const canForce = showWarning && warningData.warningType !== 'move_to_section'

	return (
		<div className="border-border/40 border-b py-2">
			{showWarning && (
				<WarningBanner
					actionData={warningData}
					onDismiss={() => setWarningDismissed(true)}
					onMoved={() => setName('')}
				/>
			)}
			<fetcher.Form
				method="POST"
				onSubmit={(event) => {
					if (!name.trim()) event.preventDefault()
				}}
				className="flex items-center gap-2"
			>
				<HouseholdClientInput />
				<input type="hidden" name="intent" value="add" />
				<input type="hidden" name="horizon" value={LATER} />
				{canForce && <input type="hidden" name="force" value="true" />}
				<Input
					ref={inputRef}
					name="name"
					value={name}
					onChange={(event) => {
						setName(event.target.value)
						setWarningDismissed(false)
					}}
					placeholder="Add to Later…"
					enterKeyHint="go"
					autoCapitalize="none"
					className="min-w-0 flex-1"
				/>
				<button
					type="submit"
					disabled={!name.trim() || fetcher.state !== 'idle'}
					className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
					aria-label={canForce ? 'Add to Later anyway' : 'Add to Later'}
				>
					<Icon name="plus" className="size-5" />
				</button>
			</fetcher.Form>
		</div>
	)
}

/** A row placed by its check, and the part of Next shop it shows in. */
export type ListedRow = PlacedRow<DisplayShoppingItem> & {
	group?: 'to-buy' | 'checked'
}

/**
 * One keyed list, so a row whose check moves it stays the same element (an
 * open editor, menu or swipe stays with it). `checkedHeading` goes before the
 * first checked row.
 */
export function ShoppingItems({
	checks,
	rows,
	voiceAddedNames,
	moving,
	checkedHeading,
	className,
}: {
	rows: ListedRow[]
	checks: ReturnType<typeof useShoppingChecks>
	voiceAddedNames: Set<string>
	/** Whether a row's check is moving it (useCheckMoves). */
	moving: (id: string) => boolean
	checkedHeading?: ReactNode
	className?: string
}) {
	const hidden = useHiddenRows()
	const entering = useEnteringRows()
	const firstChecked = rows.findIndex((row) => row.group === 'checked')
	return (
		<div className={cn('divide-border/40 divide-y', className)}>
			{rows.flatMap(({ item, folding, arriving, group }, index) => [
				...(index === firstChecked && checkedHeading
					? [<Fragment key="checked-heading">{checkedHeading}</Fragment>]
					: []),
				// A deleted row closes its gap, and Undo opens it again. A row
				// its check moves folds the same way, and opens in its new place.
				<RowCollapse
					key={item.id}
					data-shopping-group={group}
					hidden={hidden.has(item.id) || folding}
					entering={entering.has(item.id) || arriving}
					instant={(hidden.get(item.id) ?? entering.get(item.id)) === 'instant'}
				>
					<ShoppingListItemCard
						checks={checks}
						item={item}
						isVoiceAdded={voiceAddedNames.has(item.name.toLowerCase().trim())}
						moving={moving(item.id)}
					/>
				</RowCollapse>,
			])}
		</div>
	)
}

type ClearCheckedProps = {
	/** The checked items on screen whose check is saved. */
	checked: Array<{ id: string }>
	horizon: ShoppingHorizon
	/** Set at the right of the Checked heading, rather than under the list. */
	inHeading?: boolean
}

/**
 * Clears at once, with Undo. The rows go without an animation; only the rows
 * on screen now are sent, so an item checked on the other phone a moment ago
 * stays.
 */
export function ClearCheckedControl({
	checked,
	horizon,
	inHeading = false,
}: ClearCheckedProps) {
	const deleteWithUndo = useDeleteWithUndo()
	if (checked.length === 0) return null
	// At most 500 at a time (resources/undo-delete); a tap again clears more.
	const checkedIds = checked.slice(0, 500).map((item) => item.id)
	const sectionLabel = horizon === LATER ? 'Later' : 'Next shop'
	const count = checkedIds.length
	const clear = () =>
		deleteWithUndo({
			key: `clear-checked:${horizon}:${checkedIds.join(',')}`,
			hides: checkedIds,
			style: 'instant',
			message: `Cleared ${count} checked item${count === 1 ? '' : 's'}`,
			what: `the checked item${count === 1 ? '' : 's'}`,
			verb: 'clear',
			// Only rows still checked go: one unchecked on the other phone a
			// moment ago stays.
			request: {
				intent: 'delete-shopping',
				itemIds: checkedIds,
				checkedOnly: true,
			},
		})
	if (inHeading) {
		return (
			<button
				type="button"
				aria-label={`Clear checked items from ${sectionLabel}`}
				onClick={clear}
				// 44px tall; the negative margin ends the words on the content edge.
				className="text-primary -mr-3 ml-auto flex min-h-11 items-center px-3 text-[0.84375rem] font-semibold"
			>
				Clear checked
			</button>
		)
	}
	return (
		<div className="animate-slide-up-reveal flex items-center justify-center pt-1">
			<Button
				type="button"
				variant="link"
				aria-label={`Clear checked items from ${sectionLabel}`}
				onClick={clear}
				// 44px tall for the thumb; pt-1 above keeps the link where it was.
				className="text-muted-foreground hover:text-foreground min-h-11 px-3 py-0 text-sm underline underline-offset-2"
			>
				Clear checked
			</Button>
		</div>
	)
}
