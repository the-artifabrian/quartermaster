import { type InventoryItem } from '@prisma/client'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx'
import { Icon } from './ui/icon.tsx'
import { Input } from './ui/input.tsx'

type InventoryItemCardProps = {
	item: InventoryItem
	showActions?: boolean
}

function getExpiryDisplay(expiresAt: Date | string) {
	const now = new Date()
	const expires = new Date(expiresAt)
	const diffMs = expires.getTime() - now.getTime()
	const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

	if (diffDays < 0) {
		const daysAgo = Math.abs(diffDays)
		return {
			text: daysAgo === 1 ? 'Expired yesterday' : `Expired ${daysAgo}d ago`,
			className:
				'bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300',
			urgent: true,
		}
	}
	if (diffDays === 0) {
		return {
			text: 'Expires today',
			className:
				'bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300',
			urgent: true,
		}
	}
	if (diffDays === 1) {
		return {
			text: 'Tomorrow',
			className:
				'bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
			urgent: true,
		}
	}
	if (diffDays <= 7) {
		return {
			text: `${diffDays}d left`,
			className:
				'bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
			urgent: true,
		}
	}
	return {
		text: `${expires.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
		className: '',
		urgent: false,
	}
}

function formatDateForInput(date: Date | string | null): string {
	if (!date) return ''
	const d = new Date(date)
	return d.toISOString().split('T')[0] ?? ''
}

export function InventoryItemCard({
	item,
	showActions = true,
}: InventoryItemCardProps) {
	const [isQuickEditing, setIsQuickEditing] = useState(false)
	const [confirmDelete, setConfirmDelete] = useState(false)
	const quickEditFetcher = useFetcher()
	const lowStockFetcher = useFetcher()
	const deleteFetcher = useFetcher()
	const prevQuickEditState = useRef(quickEditFetcher.state)

	// Close edit mode when fetcher transitions from submitting/loading → idle
	// (only on success — if server returned an error, keep editing open)
	useEffect(() => {
		if (
			prevQuickEditState.current !== 'idle' &&
			quickEditFetcher.state === 'idle'
		) {
			if (isQuickEditing && quickEditFetcher.data?.status !== 'error') {
				setIsQuickEditing(false)
			}
		}
		prevQuickEditState.current = quickEditFetcher.state
	}, [quickEditFetcher.state, quickEditFetcher.data?.status, isQuickEditing])

	// Optimistic delete — hide row immediately
	if (deleteFetcher.state !== 'idle') return null

	// Optimistic low-stock state
	const optimisticLowStock =
		lowStockFetcher.formData?.get('intent') === 'toggle-low-stock'
			? !item.lowStock
			: item.lowStock

	const expiryInfo = item.expiresAt ? getExpiryDisplay(item.expiresAt) : null
	const showExpiry = expiryInfo?.urgent

	return (
		<div className="group hover:bg-muted/30 flex items-center gap-3 py-3 transition-colors">
			{/* Main content */}
			<div className="min-w-0 flex-1">
				{isQuickEditing ? (
					<quickEditFetcher.Form
						method="POST"
						className="space-y-2"
						onKeyDown={(e) => {
							if (e.key === 'Escape') setIsQuickEditing(false)
						}}
					>
						<input type="hidden" name="intent" value="quick-update" />
						<input type="hidden" name="itemId" value={item.id} />
						<div className="flex flex-wrap gap-2">
							<Input
								name="expiresAt"
								type="date"
								defaultValue={formatDateForInput(item.expiresAt)}
								className="h-8 w-32.5"
								aria-label="Expiry date"
								autoFocus
							/>
						</div>
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setIsQuickEditing(false)}
							>
								Cancel
							</Button>
							<Button type="submit" size="sm">
								<Icon name="check" size="sm" />
								Save
							</Button>
						</div>
					</quickEditFetcher.Form>
				) : (
					<div className="flex items-center gap-2">
						{/* Low stock dot */}
						{optimisticLowStock && (
							<span
								className="bg-accent size-1.5 shrink-0 rounded-full"
								title="Low stock"
							/>
						)}
						{/* Name */}
						<span className="line-clamp-1 text-[15px]">{item.name}</span>
						{/* Expiry pill — only when ≤7 days or expired */}
						{showExpiry && expiryInfo && (
							<span
								className={cn(
									'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] leading-none font-medium',
									expiryInfo.className,
								)}
							>
								{expiryInfo.text}
							</span>
						)}
					</div>
				)}
			</div>

			{/* Actions — overflow only on mobile, pencil + overflow on desktop hover */}
			{showActions && !isQuickEditing && (
				<div className="flex shrink-0 items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
					<Button
						size="sm"
						variant="ghost"
						className="hidden size-7 p-0 sm:inline-flex"
						onClick={() => setIsQuickEditing(true)}
						aria-label="Quick edit"
					>
						<Icon name="pencil-1" size="sm" />
					</Button>
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
							<DropdownMenuItem asChild>
								<Link to={`/inventory/${item.id}/edit`}>
									<Icon name="pencil-2" size="sm" />
									Full edit
								</Link>
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
}
