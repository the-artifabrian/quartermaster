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

type InventoryQuickAddProps = {
	isProActive: boolean
	onVoiceItemsAdded?: (names: string[]) => void
}

type ActionData = {
	status: 'success' | 'merged' | 'error' | 'duplicate_warning'
	existingItem?: {
		id: string
		name: string
	}
	mergedInto?: string
	message?: string
}

export function InventoryQuickAdd({
	isProActive,
	onVoiceItemsAdded,
}: InventoryQuickAddProps) {
	const [name, setName] = useState('')
	const fetcher = useFetcher<ActionData>()
	const [lastWarningName, setLastWarningName] = useState('')
	const nameRef = useRef<HTMLInputElement>(null)

	const isDuplicateWarning =
		fetcher.data?.status === 'duplicate_warning' && name === lastWarningName

	const prevFetcherData = useRef(fetcher.data)

	// Track which name triggered the warning so editing dismisses it,
	// and reset form after success or merge
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
			nameRef.current?.focus()
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
				nameRef.current?.focus()
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
			}
		},
		[bulkFetcher, onVoiceItemsAdded],
	)
	const handleSpeechError = useCallback((msg: string) => toast.error(msg), [])
	const { isRecording, isTranscribing, startRecording, stopRecording } =
		useSpeechToText({
			onResult: handleSpeechResult,
			onError: handleSpeechError,
		})

	return (
		<div>
			<fetcher.Form
				method="POST"
				className="border-border flex items-end gap-2 border-b pb-2"
				onSubmit={(e) => {
					if (!name.trim()) {
						e.preventDefault()
						return
					}
				}}
			>
				<input type="hidden" name="intent" value="create" />
				<div className="min-w-0 flex-1">
					<input
						ref={nameRef}
						name="name"
						placeholder="Add an item..."
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="placeholder:text-muted-foreground h-9 w-full border-0 bg-transparent px-0 text-sm shadow-none outline-none focus-visible:ring-0"
					/>
				</div>
				{isProActive && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={isRecording ? stopRecording : startRecording}
						disabled={isTranscribing}
						className={cn(
							'size-8 shrink-0 rounded-full p-0',
							isRecording
								? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse'
								: 'text-muted-foreground hover:bg-muted',
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
							<Icon name="update" className="animate-spin" size="sm" />
						) : (
							<Icon name="microphone" size="sm" />
						)}
					</Button>
				)}
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:bg-muted size-8 shrink-0 rounded-full p-0"
					disabled={!name.trim() || fetcher.state !== 'idle'}
				>
					<Icon name="plus" size="sm" />
				</Button>
			</fetcher.Form>

			{isDuplicateWarning && fetcher.data?.existingItem && (
				<div className="bg-accent/10 mt-2 rounded-lg p-3">
					<p className="text-sm">
						You already have <strong>{fetcher.data.existingItem.name}</strong>{' '}
						in your Pantry.
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
	)
}
