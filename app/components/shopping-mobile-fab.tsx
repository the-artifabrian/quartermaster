import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import { cn } from '#app/utils/misc.tsx'
import { NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { useModal } from '#app/utils/use-modal.ts'

export function MobileFabAdd({
	open,
	onOpenChange,
	isProActive,
	onVoiceItemsAdded,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	isProActive: boolean
	onVoiceItemsAdded?: (names: string[]) => void
}) {
	const fetcher = useFetcher<Record<string, unknown>>()
	const [name, setName] = useState('')
	const [quantity, setQuantity] = useState('')
	const [unit, setUnit] = useState('')
	const [showQty, setShowQty] = useState(false)
	const [warningDismissed, setWarningDismissed] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const qtyInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [open])

	useEffect(() => {
		if (showQty) {
			qtyInputRef.current?.focus()
		}
	}, [showQty])

	const prevState = useRef(fetcher.state)
	useEffect(() => {
		if (
			prevState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			setName('')
			setQuantity('')
			setUnit('')
			setWarningDismissed(false)
			inputRef.current?.focus()
		}
		prevState.current = fetcher.state
	}, [fetcher.state, fetcher.data])

	const bulkAddFetcher = useFetcher()
	const moveItemsFetcher = useFetcher()
	const revalidator = useRevalidator()

	const prevBulkState = useRef(bulkAddFetcher.state)
	useEffect(() => {
		if (prevBulkState.current !== 'idle' && bulkAddFetcher.state === 'idle') {
			void revalidator.revalidate()
			const result = bulkAddFetcher.data as
				| {
						addedCount?: number
						moveItemIds?: string[]
				  }
				| undefined
			const moveItemIds = result?.moveItemIds ?? []
			if (typeof result?.addedCount === 'number' && result.addedCount > 0) {
				toast.success(
					`Added ${result.addedCount} item${result.addedCount === 1 ? '' : 's'}`,
				)
			}
			if (moveItemIds.length > 0) {
				toast.info(
					`${moveItemIds.length} item${moveItemIds.length === 1 ? ' is' : 's are'} already in Later`,
					{
						action: {
							label: 'Move to Next shop',
							onClick: () => {
								const data = new FormData()
								data.set('intent', 'move-items')
								data.set('itemIds', JSON.stringify(moveItemIds))
								data.set('horizon', NEXT_SHOP)
								void moveItemsFetcher.submit(data, { method: 'POST' })
							},
						},
					},
				)
			}
		}
		prevBulkState.current = bulkAddFetcher.state
	}, [bulkAddFetcher.state, bulkAddFetcher.data, moveItemsFetcher, revalidator])

	const handleSpeechResult = useCallback(
		(items: TranscribedItem[], transcription: string | null) => {
			if (items.length === 1) {
				const item = items[0]!
				setName(item.name)
				if (item.quantity || item.unit) {
					setQuantity(item.quantity)
					setUnit(item.unit)
					setShowQty(true)
				}
				if (transcription) {
					toast.info(`Heard: "${transcription}"`)
				}
				inputRef.current?.focus()
			} else {
				const fd = new FormData()
				fd.set('intent', 'bulk-add')
				fd.set('items', JSON.stringify(items))
				fd.set('horizon', NEXT_SHOP)
				void bulkAddFetcher.submit(fd, { method: 'POST' })
				onVoiceItemsAdded?.(items.map((i) => i.name))
				const heard =
					transcription &&
					(transcription.length > 60
						? transcription.slice(0, 60) + '…'
						: transcription)
				if (heard) toast.info(`Heard: "${heard}"`)
				onOpenChange(false)
			}
		},
		[bulkAddFetcher, onOpenChange, onVoiceItemsAdded],
	)
	const handleSpeechError = useCallback((msg: string) => toast.error(msg), [])
	const { isRecording, isTranscribing, startRecording, stopRecording } =
		useSpeechToText({
			onResult: handleSpeechResult,
			onError: handleSpeechError,
		})
	const warningData =
		fetcher.data &&
		typeof fetcher.data === 'object' &&
		'warningType' in fetcher.data &&
		fetcher.data.status === 'warning'
			? fetcher.data
			: null
	const showWarning = !warningDismissed && warningData != null
	const canForce = showWarning && warningData.warningType !== 'move_to_section'

	// print:hidden guards browser-initiated Cmd+P — print pages are narrower
	// than the md breakpoint, so the fixed FAB would repeat on every page
	return (
		<div className="md:hidden print:hidden">
			{open && (
				<AddItemSheet onClose={() => onOpenChange(false)}>
					{showWarning && (
						<WarningBanner
							actionData={warningData}
							onDismiss={() => setWarningDismissed(true)}
							onMoved={() => {
								setName('')
								setQuantity('')
								setUnit('')
							}}
						/>
					)}
					<fetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!name.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="add" />
						<input type="hidden" name="horizon" value={NEXT_SHOP} />
						{canForce && <input type="hidden" name="force" value="true" />}
						<div className="flex items-center gap-2">
							<input
								ref={inputRef}
								name="name"
								value={name}
								onChange={(e) => {
									setName(e.target.value)
									setWarningDismissed(false)
								}}
								placeholder="Add an item..."
								className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 focus:ring-primary/20 h-10 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-1"
							/>
							{isProActive && (
								<button
									type="button"
									onClick={isRecording ? stopRecording : startRecording}
									disabled={isTranscribing}
									className={cn(
										'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
										isRecording
											? 'bg-destructive text-destructive-foreground animate-pulse'
											: 'bg-muted text-muted-foreground',
									)}
									aria-label={
										isRecording
											? 'Stop recording'
											: isTranscribing
												? 'Transcribing...'
												: 'Voice input'
									}
								>
									{isTranscribing ? (
										<Icon name="update" className="size-4 animate-spin" />
									) : (
										<Icon name="microphone" className="size-5" />
									)}
								</button>
							)}
							<button
								type="submit"
								disabled={!name.trim() || fetcher.state !== 'idle'}
								className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
								aria-label={canForce ? 'Add anyway' : 'Add to Next shop'}
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						{showQty ? (
							<div className="mt-2 flex items-center gap-2">
								<input
									ref={qtyInputRef}
									name="quantity"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									placeholder="Qty"
									className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 h-8 w-16 rounded-lg border bg-transparent px-2 text-sm outline-none"
								/>
								<input
									name="unit"
									value={unit}
									onChange={(e) => setUnit(e.target.value)}
									placeholder="Unit"
									className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-sm outline-none"
								/>
								<button
									type="button"
									onPointerDown={(e) => {
										e.preventDefault()
										setShowQty(false)
										inputRef.current?.focus()
									}}
									className="text-muted-foreground/60 hover:text-muted-foreground shrink-0 text-xs"
								>
									Hide
								</button>
							</div>
						) : (
							<button
								type="button"
								onPointerDown={(e) => {
									e.preventDefault()
									setShowQty(true)
								}}
								className="text-muted-foreground/60 hover:text-muted-foreground mt-1.5 text-xs"
							>
								+ Qty &amp; unit
							</button>
						)}
					</fetcher.Form>
				</AddItemSheet>
			)}
			{!open && (
				<button
					type="button"
					className="bg-primary text-primary-foreground shadow-warm-md fixed right-4 bottom-[5.5rem] z-50 flex size-12 items-center justify-center rounded-full transition-all active:scale-95"
					aria-label="Add item"
					onClick={() => onOpenChange(true)}
				>
					<Icon name="plus" className="size-6" />
				</button>
			)}
		</div>
	)
}

/**
 * Sheet chrome with modal keyboard behavior (D5): Escape closes, focus is
 * trapped while open and returns to the FAB on close — same pattern as the
 * recipe ingredients sheet.
 */
function AddItemSheet({
	onClose,
	children,
}: {
	onClose: () => void
	children: React.ReactNode
}) {
	const dialogRef = useModal(onClose)

	return (
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="shopping-add-sheet-title"
		>
			<div className="fixed inset-0 z-40 bg-black/15" onClick={onClose} />
			<div className="animate-slide-up-reveal border-border/60 bg-card shadow-warm-lg fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 rounded-t-xl border-t p-4">
				<div className="mb-2 flex items-center justify-between">
					<span id="shopping-add-sheet-title" className="text-sm font-medium">
						Add to list
					</span>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground -m-1 p-1"
						aria-label="Close"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				{children}
			</div>
		</div>
	)
}
