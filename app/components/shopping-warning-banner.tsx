import { Icon } from '#app/components/ui/icon.tsx'

export function WarningBanner({
	actionData,
	onDismiss,
}: {
	actionData: Record<string, unknown>
	onDismiss: () => void
}) {
	if (actionData.warningType === 'already_on_list') {
		const qty = actionData.existingQuantity
			? `${actionData.existingQuantity}${actionData.existingUnit ? ` ${actionData.existingUnit}` : ''}`
			: null
		return (
			<div className="bg-accent/10 mb-3 flex items-start gap-2 rounded-lg p-3">
				<Icon
					name="question-mark-circled"
					className="text-accent mt-0.5 size-4 shrink-0"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.existingName as string} is already on your list
						{qty ? ` (${qty})` : ''}.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Tap + to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline underline-offset-2"
						>
							cancel
						</button>
						.
					</p>
				</div>
			</div>
		)
	}

	if (actionData.warningType === 'in_inventory') {
		return (
			<div className="bg-accent/10 mb-3 flex items-start gap-2 rounded-lg p-3">
				<Icon
					name="question-mark-circled"
					className="text-accent mt-0.5 size-4 shrink-0"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.inventoryName as string} is usually on hand.
					</p>
					<p className="text-muted-foreground mt-0.5">
						Tap + to add anyway, or{' '}
						<button
							type="button"
							onClick={onDismiss}
							className="text-primary underline underline-offset-2"
						>
							cancel
						</button>
						.
					</p>
				</div>
			</div>
		)
	}

	return null
}
