import { type InventoryItem } from '@prisma/client'
import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'

const locationDotColors: Record<string, string> = {
	pantry: 'bg-amber-500',
	fridge: 'bg-blue-500',
	freezer: 'bg-cyan-500',
}

const ALL_LOCATIONS = ['pantry', 'fridge', 'freezer'] as const

type InventoryItemCardProps = {
	item: InventoryItem
	showActions?: boolean
	showLocation?: boolean
}

export function InventoryItemCard({
	item,
	showActions = true,
	showLocation = false,
}: InventoryItemCardProps) {
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [editing, setEditing] = useState(false)
	const [editName, setEditName] = useState(item.name)
	const inputRef = useRef<HTMLInputElement>(null)
	const lowStockFetcher = useFetcher()
	const deleteFetcher = useFetcher()
	const renameFetcher = useFetcher<{ status: string; message?: string }>()
	const moveFetcher = useFetcher()

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

	// Optimistic delete — hide row immediately
	if (deleteFetcher.state !== 'idle') return null

	// Optimistic move — hide from current location view
	if (moveFetcher.state !== 'idle') return null

	// Optimistic low-stock state
	const optimisticLowStock =
		lowStockFetcher.formData?.get('intent') === 'toggle-low-stock'
			? !item.lowStock
			: item.lowStock

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

	const otherLocations = ALL_LOCATIONS.filter((loc) => loc !== item.location)

	return (
		<div className="group hover:bg-muted/30 flex items-center gap-3 py-3 transition-colors">
			{/* Main content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					{/* Low stock dot */}
					{optimisticLowStock && (
						<span
							className="bg-accent size-1.5 shrink-0 rounded-full"
							title="Low stock"
						/>
					)}
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
							)}
						>
							{optimisticName}
						</button>
					)}
					{/* Location badge (for All tab) */}
					{showLocation && (
						<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
							<span
								className={cn(
									'size-1.5 rounded-full',
									locationDotColors[item.location] ?? 'bg-muted-foreground',
								)}
							/>
							{LOCATION_LABELS[item.location as keyof typeof LOCATION_LABELS]}
						</span>
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
									void lowStockFetcher.submit(
										{ intent: 'toggle-low-stock', itemId: item.id },
										{ method: 'POST' },
									)
								}}
							>
								<Icon
									name="question-mark-circled"
									size="sm"
									className={cn(optimisticLowStock && 'text-amber-600')}
								/>
								{optimisticLowStock ? 'Clear low stock' : 'Mark as low stock'}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							{otherLocations.map((loc) => (
								<DropdownMenuItem
									key={loc}
									onSelect={() => {
										void moveFetcher.submit(
											{ intent: 'move', itemId: item.id, location: loc },
											{ method: 'POST' },
										)
									}}
								>
									<Icon name="update" size="sm" />
									Move to {LOCATION_LABELS[loc]}
								</DropdownMenuItem>
							))}
							<DropdownMenuSeparator />
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
}
