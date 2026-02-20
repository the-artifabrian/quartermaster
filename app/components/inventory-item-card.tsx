import { type InventoryItem } from '@prisma/client'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
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

const locationBadgeColors: Record<string, string> = {
	pantry: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
	fridge: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
	freezer: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
}

type InventoryItemCardProps = {
	item: InventoryItem
	showActions?: boolean
	showLocation?: boolean
}

function getExpiryDisplay(expiresAt: Date | string) {
	const now = new Date()
	const expires = new Date(expiresAt)
	const diffMs = expires.getTime() - now.getTime()
	const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

	if (diffDays < 0) {
		const daysAgo = Math.abs(diffDays)
		return {
			text: daysAgo === 1 ? 'Expired yesterday' : `Expired ${daysAgo} days ago`,
			className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
		}
	}
	if (diffDays === 0) {
		return {
			text: 'Expires today',
			className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
		}
	}
	if (diffDays === 1) {
		return {
			text: 'Expires tomorrow',
			className:
				'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
		}
	}
	if (diffDays <= 7) {
		return {
			text: `Expires in ${diffDays} days`,
			className:
				'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
		}
	}
	return {
		text: `Expires ${expires.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
		className: '',
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
	showLocation = true,
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

	// Optimistic delete — hide card immediately
	if (deleteFetcher.state !== 'idle') return null

	// Optimistic low-stock state
	const optimisticLowStock =
		lowStockFetcher.formData?.get('intent') === 'toggle-low-stock'
			? !item.lowStock
			: item.lowStock

	return (
		<div className="group bg-card text-card-foreground shadow-warm hover:shadow-warm-md rounded-xl border transition-all duration-200 hover:-translate-y-0.5">
			<div className="flex items-start justify-between gap-2 p-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="line-clamp-1 font-semibold">{item.name}</h3>
						{showLocation && (
							<span
								className={cn(
									'rounded-full px-2 py-0.5 text-xs font-medium',
									locationBadgeColors[item.location] ??
										'bg-muted text-muted-foreground',
								)}
							>
								{LOCATION_LABELS[item.location as keyof typeof LOCATION_LABELS]}
							</span>
						)}
						{optimisticLowStock && (
							<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200">
								Low
							</span>
						)}
					</div>

					{isQuickEditing ? (
						<quickEditFetcher.Form
							method="POST"
							className="mt-2 space-y-2"
							onKeyDown={(e) => {
								if (e.key === 'Escape') setIsQuickEditing(false)
							}}
						>
							<input type="hidden" name="intent" value="quick-update" />
							<input type="hidden" name="itemId" value={item.id} />
							<div className="flex gap-2">
								<Input
									name="quantity"
									defaultValue={item.quantity ?? ''}
									placeholder="Qty"
									className="w-20"
									autoFocus
								/>
								<Input
									name="unit"
									defaultValue={item.unit ?? ''}
									placeholder="Unit"
									className="w-24"
								/>
								<Input
									name="expiresAt"
									type="date"
									defaultValue={formatDateForInput(item.expiresAt)}
									className="w-[130px]"
									aria-label="Expiry date"
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
						<div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
							{item.quantity && (
								<span>
									{item.quantity} {item.unit}
								</span>
							)}
							{item.expiresAt &&
								(() => {
									const expiry = getExpiryDisplay(item.expiresAt)
									return (
										<>
											<span>•</span>
											{expiry.className ? (
												<span
													className={cn(
														'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
														expiry.className,
													)}
												>
													{expiry.text}
												</span>
											) : (
												<span>{expiry.text}</span>
											)}
										</>
									)
								})()}
						</div>
					)}
				</div>

				{showActions && !isQuickEditing && (
					<div className="flex items-center gap-1">
						<Button
							size="sm"
							variant="ghost"
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
								<Button size="sm" variant="ghost" aria-label="More actions">
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
		</div>
	)
}

export function InventoryItemGrid({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
			{children}
		</div>
	)
}
