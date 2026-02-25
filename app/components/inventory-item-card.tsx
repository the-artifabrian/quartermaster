import { type InventoryItem } from '@prisma/client'
import { useState } from 'react'
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

type InventoryItemCardProps = {
	item: InventoryItem
	showActions?: boolean
}

export function InventoryItemCard({
	item,
	showActions = true,
}: InventoryItemCardProps) {
	const [confirmDelete, setConfirmDelete] = useState(false)
	const lowStockFetcher = useFetcher()
	const deleteFetcher = useFetcher()

	// Optimistic delete — hide row immediately
	if (deleteFetcher.state !== 'idle') return null

	// Optimistic low-stock state
	const optimisticLowStock =
		lowStockFetcher.formData?.get('intent') === 'toggle-low-stock'
			? !item.lowStock
			: item.lowStock

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
					{/* Name */}
					<span className="line-clamp-1 text-[15px]">{item.name}</span>
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
