import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { type InventoryItem } from '#app/generated/prisma/client.ts'
import { formatItemAge } from '#app/utils/date.ts'
import { cn } from '#app/utils/misc.tsx'
import { SwipeableRow } from './swipeable-row.tsx'
import { Button } from './ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'

type InventoryItemCardProps = {
	isVoiceAdded?: boolean
	item: InventoryItem
	showActions?: boolean
}

export function InventoryItemCard({
	item,
	showActions = true,
	isVoiceAdded,
}: InventoryItemCardProps) {
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [editing, setEditing] = useState(false)
	const [editName, setEditName] = useState(item.name)
	const inputRef = useRef<HTMLInputElement>(null)
	const deleteFetcher = useFetcher()
	const renameFetcher = useFetcher<{ status: string; message?: string }>()
	const shoppingFetcher = useFetcher<{ status: string; action?: string }>()

	// Focus input when entering edit mode
	useEffect(() => {
		if (editing) {
			inputRef.current?.focus()
			inputRef.current?.select()
		}
	}, [editing])

	// Reset edit name if rename fails (server returned error)
	useEffect(() => {
		if (renameFetcher.state === 'idle' && renameFetcher.data?.status === 'error') {
			setEditName(item.name)
		}
	}, [renameFetcher.state, renameFetcher.data, item.name])

	// Toast on add-to-shopping completion
	useEffect(() => {
		if (
			shoppingFetcher.state === 'idle' &&
			shoppingFetcher.data?.action === 'add-to-shopping'
		) {
			if (shoppingFetcher.data.status === 'success') {
				toast.success('Added to shopping list')
			}
		}
	}, [shoppingFetcher.state, shoppingFetcher.data])

	// Optimistic delete — hide row immediately
	if (deleteFetcher.state !== 'idle') return null

	// Optimistic name
	const optimisticName =
		renameFetcher.formData?.get('intent') === 'rename'
			? String(renameFetcher.formData.get('name') ?? item.name)
			: item.name

	const saveRename = () => {
		const trimmed = editName.trim()
		if (!trimmed || trimmed === item.name) {
			setEditName(item.name)
			setEditing(false)
			return
		}
		void renameFetcher.submit(
			{ intent: 'rename', itemId: item.id, name: trimmed },
			{ method: 'POST' },
		)
		setEditing(false)
	}

	const row = (
		<div className={"group hover:bg-muted/30 flex items-center gap-3 py-3 transition-colors"}>
			{/* Main content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					{/* Name — inline edit */}
					{editing ? (
						<input
							ref={inputRef}
							type="text"
							value={editName}
							onChange={(e) => setEditName(e.target.value)}
							onBlur={saveRename}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault()
									saveRename()
								}
								if (e.key === 'Escape') {
									setEditName(item.name)
									setEditing(false)
								}
							}}
							className="min-w-0 flex-1 rounded border border-border/50 bg-transparent px-1.5 py-0.5 text-[15px] outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
							maxLength={100}
						/>
					) : (
						<>
							<button
								type="button"
								onClick={() => {
									if (showActions) {
										setEditName(item.name)
										setEditing(true)
									}
								}}
								className={cn(
									'line-clamp-1 text-left text-[15px]',
									showActions &&
										'cursor-text rounded px-1.5 py-0.5 -ml-1.5 hover:bg-muted/50',
									isVoiceAdded && 'text-amber-500/80',
								)}
							>
								{optimisticName}
							</button>
							<span className="shrink-0 text-xs text-muted-foreground/50">
								{formatItemAge(new Date(item.createdAt))}
							</span>
							{isVoiceAdded && (
								<Icon
									name="microphone"
									className="ml-1.5 inline size-4 shrink-0 text-amber-500/80"
								/>
							)}
						</>
					)}
				</div>
			</div>

			{/* Actions — overflow menu */}
			{showActions && (
				<div className="flex shrink-0 items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
					<DropdownMenu
						onOpenChange={(open) => {
							if (!open) setConfirmDelete(false)
						}}
					>
						<DropdownMenuTrigger asChild>
							<Button
								size="sm"
								variant="ghost"
								className="size-7 p-0"
								aria-label="More actions"
							>
								<Icon name="dots-horizontal" size="sm" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={() => {
									void shoppingFetcher.submit(
										{ intent: 'add-to-shopping', itemId: item.id },
										{ method: 'POST' },
									)
								}}
							>
								<Icon name="cart" size="sm" />
								Add to shopping list
							</DropdownMenuItem>
							<DropdownMenuItem
								className={cn(
									confirmDelete
										? 'bg-destructive text-destructive-foreground focus:bg-destructive focus:text-destructive-foreground'
										: 'text-destructive focus:text-destructive',
								)}
								onSelect={(e) => {
									if (!confirmDelete) {
										e.preventDefault()
										setConfirmDelete(true)
									} else {
										void deleteFetcher.submit(
											{ intent: 'delete', itemId: item.id },
											{ method: 'POST' },
										)
									}
								}}
							>
								<Icon name="trash" size="sm" />
								{confirmDelete ? 'Are you sure?' : 'Delete'}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
		</div>
	)

	if (!showActions) return row

	return (
		<SwipeableRow
			onAction={() => {
				void deleteFetcher.submit(
					{ intent: 'delete', itemId: item.id },
					{ method: 'POST' },
				)
			}}
		>
			{row}
		</SwipeableRow>
	)
}
