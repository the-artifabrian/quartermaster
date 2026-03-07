import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { Icon } from '#app/components/ui/icon.tsx'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import { cn } from '#app/utils/misc.tsx'

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
	const fetcher = useFetcher<{ status: string }>()
	const [name, setName] = useState('')
	const [quantity, setQuantity] = useState('')
	const [unit, setUnit] = useState('')
	const [showQty, setShowQty] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [open])

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
			inputRef.current?.focus()
		}
		prevState.current = fetcher.state
	}, [fetcher.state, fetcher.data])

	const bulkAddFetcher = useFetcher()
	const revalidator = useRevalidator()

	const prevBulkState = useRef(bulkAddFetcher.state)
	useEffect(() => {
		if (prevBulkState.current !== 'idle' && bulkAddFetcher.state === 'idle') {
			void revalidator.revalidate()
		}
		prevBulkState.current = bulkAddFetcher.state
	}, [bulkAddFetcher.state, revalidator])

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
				void bulkAddFetcher.submit(fd, { method: 'POST' })
				onVoiceItemsAdded?.(items.map((i) => i.name))
				const heard =
					transcription &&
					(transcription.length > 60
						? transcription.slice(0, 60) + '…'
						: transcription)
				toast.success(
					heard
						? `Heard: "${heard}" — added ${items.length} items`
						: `Added ${items.length} items`,
				)
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

	return (
		<div className="md:hidden print:hidden">
			{open && (
				<div
					className="fixed inset-0 z-40"
					onClick={() => onOpenChange(false)}
				/>
			)}
			{open && (
				<div className="fixed bottom-[9rem] right-4 z-50 w-[calc(100vw-2rem)] max-w-xs animate-fade-up-reveal rounded-xl border border-border/60 bg-card p-3 shadow-warm-lg">
					<fetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!name.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="add" />
						<input type="hidden" name="force" value="true" />
						<div className="flex items-center gap-2">
							<input
								ref={inputRef}
								name="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Add an item..."
								className="h-10 min-w-0 flex-1 rounded-lg border border-border/50 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
							/>
							{isProActive && (
								<button
									type="button"
									onClick={isRecording ? stopRecording : startRecording}
									disabled={isTranscribing}
									className={cn(
										'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
										isRecording
											? 'animate-pulse bg-destructive text-destructive-foreground'
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
								className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
						{showQty ? (
							<div className="mt-2 flex items-center gap-2">
								<input
									name="quantity"
									value={quantity}
									onChange={(e) => setQuantity(e.target.value)}
									placeholder="Qty"
									className="h-8 w-16 rounded-lg border border-border/50 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/30"
								/>
								<input
									name="unit"
									value={unit}
									onChange={(e) => setUnit(e.target.value)}
									placeholder="Unit"
									className="h-8 min-w-0 flex-1 rounded-lg border border-border/50 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/30"
								/>
								<button
									type="button"
									onClick={() => setShowQty(false)}
									className="shrink-0 text-xs text-muted-foreground/60 hover:text-muted-foreground"
								>
									Hide
								</button>
							</div>
						) : (
							<button
								type="button"
								onClick={() => setShowQty(true)}
								className="mt-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground"
							>
								+ Qty &amp; unit
							</button>
						)}
					</fetcher.Form>
				</div>
			)}
			<button
				type="button"
				className={cn(
					'fixed bottom-[5.5rem] right-4 z-50 flex size-12 items-center justify-center rounded-full shadow-warm-md transition-all active:scale-95',
					open
						? 'bg-muted text-muted-foreground'
						: 'bg-primary text-primary-foreground',
				)}
				aria-label={open ? 'Close' : 'Add item'}
				onClick={() => onOpenChange(!open)}
			>
				<Icon name={open ? 'cross-1' : 'plus'} className="size-6" />
			</button>
		</div>
	)
}
