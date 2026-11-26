import { useFetcher } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import { HouseholdClientInput } from '#app/utils/household-client.tsx'
import { LATER } from '#app/utils/shopping-horizon.ts'

export function WarningBanner({
	actionData,
	onDismiss,
	onMoved,
}: {
	actionData: Record<string, unknown>
	onDismiss: () => void
	onMoved?: () => void
}) {
	const moveFetcher = useFetcher()
	useFetcherSettled(moveFetcher, (data) => {
		if (data?.status === 'success') {
			onMoved?.()
			onDismiss()
		}
	})

	if (actionData.warningType === 'move_to_section') {
		const targetHorizon = actionData.targetHorizon as string
		const targetLabel = targetHorizon === LATER ? 'Later' : 'Next shop'
		const existingLabel =
			actionData.existingHorizon === LATER ? 'Later' : 'Next shop'
		return (
			<div className="bg-muted mb-3 flex items-start gap-2 rounded-md p-3">
				<Icon
					name="question-mark-circled"
					className="text-primary mt-0.5 size-4 shrink-0"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.existingName as string} is already in {existingLabel}.
					</p>
					<div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
						<moveFetcher.Form method="POST">
							<HouseholdClientInput />
							<input type="hidden" name="intent" value="move" />
							<input
								type="hidden"
								name="itemId"
								value={actionData.itemId as string}
							/>
							<input type="hidden" name="horizon" value={targetHorizon} />
							<button
								type="submit"
								disabled={moveFetcher.state !== 'idle'}
								className="text-primary font-medium underline underline-offset-2 disabled:opacity-50"
							>
								Move to {targetLabel}
							</button>
						</moveFetcher.Form>
						<button
							type="button"
							onClick={onDismiss}
							className="underline underline-offset-2"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		)
	}

	if (actionData.warningType === 'already_on_list') {
		const qty = actionData.existingQuantity
			? `${actionData.existingQuantity}${actionData.existingUnit ? ` ${actionData.existingUnit}` : ''}`
			: null
		return (
			<div className="bg-muted mb-3 flex items-start gap-2 rounded-md p-3">
				<Icon
					name="question-mark-circled"
					className="text-primary mt-0.5 size-4 shrink-0"
				/>
				<div className="flex-1 text-sm">
					<p className="font-medium">
						{actionData.existingName as string} is already on Shopping
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

	return null
}
