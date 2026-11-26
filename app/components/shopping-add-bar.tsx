import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { WarningBanner } from '#app/components/shopping-warning-banner.tsx'
import { BottomSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { invalidateServiceWorkerData } from '#app/components/service-worker-data-sync.tsx'
import { useFetcherSettled } from '#app/hooks/use-fetcher-settled.ts'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import {
	getHouseholdClientId,
	HouseholdClientInput,
} from '#app/utils/household-client.tsx'
import { cn } from '#app/utils/misc.tsx'
import { NEXT_SHOP } from '#app/utils/shopping-horizon.ts'

/** A row this sheet added since it opened, as the server saved it. */
type AddedRow = {
	id: string
	name: string
	quantity: string | null
	unit: string | null
	checkVersion: number
}

type AddedLine = AddedRow & {
	/** Its Undo: not tapped, waiting on the server, or refused and why. */
	undo: 'ready' | 'sending' | 'failed' | 'changed'
}

function addedRow(data: unknown): AddedRow | null {
	if (!data || typeof data !== 'object' || !('item' in data)) return null
	const item = (data as { item?: Partial<AddedRow> }).item
	return item &&
		typeof item.id === 'string' &&
		typeof item.name === 'string' &&
		typeof item.checkVersion === 'number'
		? {
				id: item.id,
				name: item.name,
				quantity: item.quantity ?? null,
				unit: item.unit ?? null,
				checkVersion: item.checkVersion,
			}
		: null
}

/**
 * Takes back a row the sheet added, if it is still the row as added
 * (resources/undo-delete): `changed` when someone checked, edited or added to
 * it since, and it stays.
 */
async function takeBack(row: AddedRow) {
	const response = await fetch('/resources/undo-delete', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({
			intent: 'take-back-add',
			itemId: row.id,
			added: {
				checkVersion: row.checkVersion,
				name: row.name,
				quantity: row.quantity,
				unit: row.unit,
			},
			originClientId: getHouseholdClientId(),
		}),
	})
	if (!response.ok) throw new Error(`Undo route answered ${response.status}`)
	const { status } = (await response.json()) as { status: string }
	if (status === 'deleted' || status === 'gone' || status === 'changed')
		return status
	throw new Error(`Unexpected answer: ${status}`)
}

/**
 * Adding on a phone: a field-shaped "Add an item" bar docked above the tab
 * bar opens the Add to Shopping sheet. The sheet is tall, with its field at
 * the top, so the keyboard has the bottom half; it stays open between adds
 * and lists what it added under the field, each with an Undo.
 */
export function ShoppingAddBar({
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
	const [added, setAdded] = useState<AddedLine[]>([])
	const inputRef = useRef<HTMLInputElement>(null)
	const qtyInputRef = useRef<HTMLInputElement>(null)

	// What was typed clears when the sheet opens again, and so do the last
	// add's warning and the list of what it added. Not on close: the sheet
	// leaves showing what it showed.
	const [wasOpen, setWasOpen] = useState(open)
	const [dataBeforeOpen, setDataBeforeOpen] = useState(fetcher.data)
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) {
			setName('')
			setQuantity('')
			setUnit('')
			setAdded([])
			setDataBeforeOpen(fetcher.data)
			setWarningDismissed(false)
		}
	}

	/**
	 * Opens the sheet and focuses its field inside the tap: iOS raises the
	 * keyboard only for a focus the tap itself makes, not one a moment later.
	 */
	function openSheet() {
		flushSync(() => onOpenChange(true))
		// The sheet is still sliding up: focusing must not scroll the page.
		inputRef.current?.focus({ preventScroll: true })
	}

	useEffect(() => {
		if (showQty) {
			qtyInputRef.current?.focus()
		}
	}, [showQty])

	useFetcherSettled(fetcher, (data) => {
		if (data?.status === 'success') {
			setName('')
			setQuantity('')
			setUnit('')
			setWarningDismissed(false)
			const row = addedRow(data)
			if (row)
				setAdded((lines) => [
					{ ...row, undo: 'ready' },
					...lines.filter((other) => other.id !== row.id),
				])
			inputRef.current?.focus()
		}
	})

	const setUndo = (id: string, undo: AddedLine['undo']) =>
		setAdded((lines) =>
			lines.map((line) => (line.id === id ? { ...line, undo } : line)),
		)

	/**
	 * The line stays until the server answers: it goes once the row is
	 * deleted, says so if the row changed and stays, and offers Undo again if
	 * the request failed.
	 */
	async function undoAdd(line: AddedLine) {
		inputRef.current?.focus({ preventScroll: true })
		setUndo(line.id, 'sending')
		let answer: Awaited<ReturnType<typeof takeBack>>
		try {
			answer = await takeBack(line)
		} catch {
			setUndo(line.id, 'failed')
			return
		}
		if (answer === 'changed') {
			setUndo(line.id, 'changed')
			return
		}
		// A write outside the Router: drop the caches and reload the list.
		invalidateServiceWorkerData()
		void revalidator.revalidate()
		setAdded((lines) => lines.filter((other) => other.id !== line.id))
	}

	const bulkAddFetcher = useFetcher()
	const moveItemsFetcher = useFetcher()
	const revalidator = useRevalidator()

	useFetcherSettled(bulkAddFetcher, (answer) => {
		void revalidator.revalidate()
		const result = answer as
			| {
					addedCount?: number
					moveItemIds?: string[]
					message?: string
			  }
			| undefined
		if (result?.message) toast.error(result.message)
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
							data.set('originClientId', getHouseholdClientId())
							data.set('intent', 'move-items')
							data.set('itemIds', JSON.stringify(moveItemIds))
							data.set('horizon', NEXT_SHOP)
							void moveItemsFetcher.submit(data, { method: 'POST' })
						},
					},
				},
			)
		}
	})

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
				fd.set('originClientId', getHouseholdClientId())
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
		fetcher.data !== dataBeforeOpen &&
		typeof fetcher.data === 'object' &&
		'warningType' in fetcher.data &&
		fetcher.data.status === 'warning'
			? fetcher.data
			: null
	const showWarning = !warningDismissed && warningData != null
	const canForce = showWarning && warningData.warningType !== 'move_to_section'

	// print:hidden guards browser-initiated Cmd+P. Print pages are narrower
	// than the md breakpoint, so the docked bar would repeat on every page.
	return (
		<div className="md:hidden print:hidden">
			{/* Stays mounted under the sheet so focus can come back to it, and
			    comes before it so the leaving sheet slides over it. Undo toasts
			    sit above it (tailwind.css, "Undo toasts"). */}
			<div
				data-shopping-add-bar=""
				className="bg-card border-border fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--bottom-nav-inset)+1px)] z-40 border-t px-4 py-2"
			>
				<button
					type="button"
					aria-haspopup="dialog"
					onClick={openSheet}
					className="bg-muted text-muted-foreground mx-auto flex h-11 w-full max-w-[480px] items-center gap-2 rounded-lg px-3 text-left text-base transition-[scale] duration-150 ease-(--ease-micro) select-none active:scale-[0.99]"
				>
					<Icon name="plus" size="sm" className="text-primary" />
					Add an item
				</button>
			</div>
			<BottomSheet
				open={open}
				onClose={() => onOpenChange(false)}
				labelledBy="shopping-add-sheet-title"
				title="Add to Shopping"
				initialFocusRef={inputRef}
				// Tall, from just under the status bar, so the field sits high
				// and the keyboard covers only the sheet's empty lower half.
				className="h-[calc(100dvh-var(--safe-top)-2.5rem)]"
			>
				<fetcher.Form
					method="POST"
					onSubmit={(e) => {
						if (!name.trim()) e.preventDefault()
					}}
				>
					<HouseholdClientInput />
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
							placeholder="Add an item…"
							enterKeyHint="go"
							autoCapitalize="none"
							// 16px, so iOS doesn't zoom the page into the field.
							className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 focus:ring-primary/20 h-11 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-base outline-none focus:ring-1"
						/>
						{isProActive && (
							<button
								type="button"
								onClick={isRecording ? stopRecording : startRecording}
								disabled={isTranscribing}
								className={cn(
									'flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
									isRecording
										? 'bg-destructive text-destructive-foreground animate-pulse'
										: 'bg-muted text-muted-foreground',
								)}
								aria-label={
									isRecording
										? 'Stop recording'
										: isTranscribing
											? 'Transcribing…'
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
							className="bg-primary-fill text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
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
								enterKeyHint="go"
								className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 h-11 w-20 rounded-lg border bg-transparent px-2 text-base outline-none"
							/>
							<input
								name="unit"
								value={unit}
								onChange={(e) => setUnit(e.target.value)}
								placeholder="Unit"
								enterKeyHint="go"
								autoCapitalize="none"
								autoCorrect="off"
								className="border-border/50 placeholder:text-muted-foreground focus:border-primary/30 h-11 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-base outline-none"
							/>
							<button
								type="button"
								onPointerDown={(e) => {
									e.preventDefault()
									setShowQty(false)
									inputRef.current?.focus()
								}}
								className="text-muted-foreground hover:text-foreground -mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-sm"
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
							className="text-muted-foreground hover:text-foreground -mx-1 flex min-h-11 items-center px-1 text-sm"
						>
							+ Qty &amp; unit
						</button>
					)}
				</fetcher.Form>
				{showWarning && (
					<div className="mt-2">
						<WarningBanner
							actionData={warningData}
							onDismiss={() => setWarningDismissed(true)}
							onMoved={() => {
								setName('')
								setQuantity('')
								setUnit('')
							}}
						/>
					</div>
				)}
				{added.length > 0 && (
					<ul
						aria-label="Just added"
						className="divide-border/40 mt-2 divide-y"
					>
						{added.map((line) => (
							<li key={line.id} className="flex min-h-12 items-center gap-3">
								<div className="min-w-0 flex-1 py-2">
									<p className="break-words">
										<span className="font-serif text-lg">{line.name}</span>
										{(line.quantity || line.unit) && (
											<span className="text-muted-foreground ml-2 text-sm">
												{[line.quantity, line.unit].filter(Boolean).join(' ')}
											</span>
										)}
									</p>
									{(line.undo === 'changed' || line.undo === 'failed') && (
										<p role="status" className="text-muted-foreground text-sm">
											{line.undo === 'changed'
												? 'It changed since you added it, so it stays.'
												: 'Couldn’t take it back. Try again.'}
										</p>
									)}
								</div>
								{line.undo !== 'changed' && (
									<button
										type="button"
										onClick={() => void undoAdd(line)}
										disabled={line.undo === 'sending'}
										aria-label={`Undo adding ${line.name}`}
										className="text-primary -mr-3 flex min-h-11 shrink-0 items-center px-3 text-sm font-semibold disabled:opacity-50"
									>
										Undo
									</button>
								)}
							</li>
						))}
					</ul>
				)}
			</BottomSheet>
		</div>
	)
}
