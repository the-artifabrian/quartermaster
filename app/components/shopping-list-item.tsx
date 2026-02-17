import { useRef, useState } from 'react'
import { Form, useFetcher } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { parseAmount } from '#app/utils/fractions.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import {
	getProduceCountDisplay,
	isWeightUnit,
} from '#app/utils/produce-weights.ts'
import { type ShoppingListItem } from '@prisma/client'

type ShoppingListItemCardProps = {
	item: ShoppingListItem
}

export function ShoppingListItemCard({ item }: ShoppingListItemCardProps) {
	const dc = useDoubleCheck()
	const [isEditing, setIsEditing] = useState(false)
	const fetcher = useFetcher()
	const prevFetcherState = useRef(fetcher.state)

	// Close edit mode when fetcher transitions from submitting/loading → idle
	// (only on success — if server returned an error, keep editing open)
	if (prevFetcherState.current !== 'idle' && fetcher.state === 'idle') {
		if (isEditing && fetcher.data?.status !== 'error') {
			setIsEditing(false)
		}
	}
	prevFetcherState.current = fetcher.state

	const serverError =
		isEditing &&
		fetcher.data?.status === 'error' &&
		fetcher.data?.submission?.error
			? 'Please check your input and try again.'
			: null

	if (isEditing) {
		return (
			<div className="bg-card rounded-lg border p-3 print:border-0 print:p-1">
				<fetcher.Form
					method="POST"
					onKeyDown={(e) => {
						if (e.key === 'Escape') setIsEditing(false)
					}}
				>
					<input type="hidden" name="intent" value="edit" />
					<input type="hidden" name="itemId" value={item.id} />
					<div className="space-y-2">
						<Input
							name="name"
							defaultValue={item.name}
							placeholder="Item name"
							autoFocus
							required
							maxLength={100}
						/>
						<div className="flex gap-2">
							<Input
								name="quantity"
								defaultValue={item.quantity ?? ''}
								placeholder="Qty"
								className="flex-1"
								maxLength={50}
							/>
							<Input
								name="unit"
								defaultValue={item.unit ?? ''}
								placeholder="Unit"
								className="flex-1"
								maxLength={20}
							/>
						</div>
						{serverError && (
							<p className="text-destructive text-sm">{serverError}</p>
						)}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setIsEditing(false)}
							>
								<Icon name="cross-1" size="sm" />
								Cancel
							</Button>
							<Button type="submit" size="sm">
								<Icon name="check" size="sm" />
								Save
							</Button>
						</div>
					</div>
				</fetcher.Form>
			</div>
		)
	}

	return (
		<div className="bg-card flex items-start gap-3 rounded-lg border p-3 print:border-0 print:p-1">
			<Form method="POST" className="pt-1 print:hidden">
				<input type="hidden" name="intent" value="toggle" />
				<input type="hidden" name="itemId" value={item.id} />
				<button type="submit" className="-m-2.5 cursor-pointer p-2.5">
					<div
						className={`flex size-6 items-center justify-center rounded border-2 ${
							item.checked ? 'border-primary bg-primary' : 'border-input'
						}`}
					>
						{item.checked && (
							<Icon
								name="check"
								size="xs"
								className="text-primary-foreground"
							/>
						)}
					</div>
				</button>
			</Form>
			<span className="hidden pt-0.5 text-base print:inline">
				{item.checked ? '\u2611' : '\u2610'}
			</span>

			<div className="flex-1">
				<p
					className={`font-medium ${item.checked ? 'text-muted-foreground/60 line-through' : ''}`}
				>
					{item.name}
				</p>
				{(item.quantity || item.unit) && (
					<p className="text-muted-foreground text-sm">
						<ProduceCountLine item={item} />
					</p>
				)}
			</div>

			{!item.checked && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setIsEditing(true)}
					className="print:hidden"
					aria-label="Edit item"
				>
					<Icon name="pencil-1" size="sm" />
				</Button>
			)}

			<Form method="POST" className="print:hidden">
				<input type="hidden" name="intent" value="delete" />
				<input type="hidden" name="itemId" value={item.id} />
				<StatusButton
					type="submit"
					variant={dc.doubleCheck ? 'destructive' : 'ghost'}
					size="sm"
					status="idle"
					{...dc.getButtonProps()}
				>
					{dc.doubleCheck ? (
						<span className="text-xs">Sure?</span>
					) : (
						<Icon name="trash" size="sm" />
					)}
				</StatusButton>
			</Form>
		</div>
	)
}

function ProduceCountLine({ item }: { item: ShoppingListItem }) {
	if (item.quantity && item.unit && isWeightUnit(item.unit)) {
		const parsed = parseAmount(item.quantity)
		if (parsed !== null) {
			const countDisplay = getProduceCountDisplay(item.name, parsed, item.unit)
			if (countDisplay) {
				return (
					<>
						{countDisplay} ({item.quantity} {item.unit})
					</>
				)
			}
		}
	}
	return (
		<>
			{item.quantity} {item.unit}
		</>
	)
}
