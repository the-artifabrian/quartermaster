import { useEffect, useId, useRef } from 'react'
import { haptic } from '#app/utils/shell-bridge.ts'
import { BottomSheet } from './bottom-sheet.tsx'
import { Button } from './button.tsx'
import { StatusButton } from './status-button.tsx'

/**
 * The question before something that cannot be undone: a sheet with what the
 * action is ("Delete this Recipe?"), one line on what is lost, a red button
 * that does it and Cancel under it. Focus starts on Cancel, so Return or a
 * stray tap of VoiceOver's double-tap keeps everything, and Escape, the
 * backdrop, Close and a pull down all cancel.
 *
 * The red button submits the form whose id is `formId`, with its own
 * `name`/`value` as the submitter, the way a submit button inside that form
 * would. The form's React Router handler sees the same submission as before.
 * A question that submits nothing (Discard Changes) passes `onConfirm`
 * instead, and may name its Cancel for what it keeps ("Keep Editing").
 */
export function ConfirmSheet({
	open,
	onCancel,
	title,
	description,
	confirmLabel,
	cancelLabel = 'Cancel',
	formId,
	onConfirm,
	name,
	value,
	pending = false,
}: {
	open: boolean
	onCancel: () => void
	title: string
	/** One line saying what is lost. */
	description: string
	confirmLabel: string
	cancelLabel?: string
	formId?: string
	/** Instead of a form to submit: what the red button does. */
	onConfirm?: () => void
	name?: string
	value?: string
	/** The submission is on its way: the red button spins and stays put. */
	pending?: boolean
}) {
	const titleId = useId()
	const cancelRef = useRef<HTMLButtonElement>(null)

	// A destructive question warns in the iOS app, as the two-tap arming did.
	useEffect(() => {
		if (open) haptic('warning')
	}, [open])

	return (
		<BottomSheet
			open={open}
			onClose={onCancel}
			labelledBy={titleId}
			title={title}
			description={description}
			initialFocusRef={cancelRef}
		>
			<div className="mt-3 flex flex-col gap-2">
				<StatusButton
					type={onConfirm ? 'button' : 'submit'}
					onClick={onConfirm}
					form={formId}
					name={name}
					value={value}
					variant="destructive"
					size="lg"
					className="phone:text-sm w-full"
					status={pending ? 'pending' : 'idle'}
					disabled={pending}
				>
					{confirmLabel}
				</StatusButton>
				<Button
					ref={cancelRef}
					type="button"
					variant="outline"
					size="lg"
					className="phone:text-sm w-full"
					onClick={onCancel}
				>
					{cancelLabel}
				</Button>
			</div>
		</BottomSheet>
	)
}
