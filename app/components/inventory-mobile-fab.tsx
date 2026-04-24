import { useCallback, useEffect, useRef, useState } from 'react'
import { useFetcher, useRevalidator } from 'react-router'
import { toast } from 'sonner'
import {
	useSpeechToText,
	type TranscribedItem,
} from '#app/hooks/use-speech-to-text.ts'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type ActionData = {
	status: 'success' | 'merged' | 'error' | 'duplicate_warning'
	existingItem?: {
		id: string
		name: string
	}
	mergedInto?: string
	message?: string
}

export function InventoryMobileFab({
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
	const [name, setName] = useState('')
	const [lastWarningName, setLastWarningName] = useState('')
	const fetcher = useFetcher<ActionData>()
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [open])

	const isDuplicateWarning =
		fetcher.data?.status === 'duplicate_warning' && name === lastWarningName

	const prevFetcherData = useRef(fetcher.data)

	useEffect(() => {
		if (fetcher.data === prevFetcherData.current) return
		prevFetcherData.current = fetcher.data

		if (fetcher.data?.status === 'duplicate_warning') {
			setLastWarningName(name)
		}

		if (
			fetcher.data?.status === 'success' ||
			fetcher.data?.status === 'merged'
		) {
			setName('')
			setLastWarningName('')
			inputRef.current?.focus()
		}
	}, [fetcher.data, name])

	function handleForceSubmit(force: 'merge' | 'add') {
		const formData = new FormData()
		formData.set('intent', 'create')
		formData.set('name', name)
		formData.set('force', force)
		void fetcher.submit(formData, { method: 'POST' })
	}

	const bulkFetcher = useFetcher()
	const revalidator = useRevalidator()

	const prevBulkState = useRef(bulkFetcher.state)
	useEffect(() => {
		if (prevBulkState.current !== 'idle' && bulkFetcher.state === 'idle') {
			void revalidator.revalidate()
		}
		prevBulkState.current = bulkFetcher.state
	}, [bulkFetcher.state, revalidator])

	const handleSpeechResult = useCallback(
		(items: TranscribedItem[], transcription: string | null) => {
			if (items.length === 1) {
				setName(items[0]!.name)
				if (transcription) {
					toast.info(`Heard: "${transcription}"`)
				}
				inputRef.current?.focus()
			} else {
				const fd = new FormData()
				fd.set('intent', 'bulk-create')
				fd.set('items', JSON.stringify(items.map((i) => ({ name: i.name }))))
				void bulkFetcher.submit(fd, { method: 'POST' })
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
		[bulkFetcher, onOpenChange, onVoiceItemsAdded],
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
				<div className="animate-fade-up-reveal border-border/60 bg-card shadow-warm-lg fixed right-4 bottom-[9rem] z-50 w-[calc(100vw-2rem)] max-w-xs rounded-xl border p-3">
					<fetcher.Form
						method="POST"
						onSubmit={(e) => {
							if (!name.trim()) e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="create" />
						<div className="flex items-center gap-2">
							<input
								ref={inputRef}
								name="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
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
							>
								<Icon name="plus" className="size-5" />
							</button>
						</div>
					</fetcher.Form>

					{isDuplicateWarning && fetcher.data?.existingItem && (
						<div className="bg-accent/10 mt-2 rounded-lg p-3">
							<p className="text-sm">
								You already have{' '}
								<strong>{fetcher.data.existingItem.name}</strong> in your
								Pantry.
							</p>
							<div className="mt-2 flex gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => handleForceSubmit('merge')}
								>
									Update existing
								</Button>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => handleForceSubmit('add')}
								>
									Add anyway
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
			<button
				type="button"
				className={cn(
					'shadow-warm-md fixed right-4 bottom-[5.5rem] z-50 flex size-12 items-center justify-center rounded-full transition-all active:scale-95',
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
