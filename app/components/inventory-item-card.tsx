import { type InventoryItem } from '@prisma/client'
import { Form, Link } from 'react-router'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
import { cn, useDoubleCheck } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'

const locationBadgeColors: Record<string, string> = {
	pantry:
		'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200',
	fridge:
		'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
	freezer:
		'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
}

type InventoryItemCardProps = {
	item: InventoryItem
	showActions?: boolean
}

export function InventoryItemCard({
	item,
	showActions = true,
}: InventoryItemCardProps) {
	const dc = useDoubleCheck()
	const isExpiringSoon =
		item.expiresAt &&
		new Date(item.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
	const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date()

	return (
		<div
			className="group bg-card text-card-foreground rounded-xl border shadow-warm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-md"
		>
			<div className="flex items-start justify-between gap-2 p-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="line-clamp-1 font-semibold">{item.name}</h3>
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-xs font-medium',
								locationBadgeColors[item.location] ??
									'bg-muted text-muted-foreground',
							)}
						>
							{LOCATION_LABELS[item.location as keyof typeof LOCATION_LABELS]}
						</span>
						{item.lowStock && (
							<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200">
								Low
							</span>
						)}
					</div>

					<div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
						{item.quantity && (
							<>
								<span>
									{item.quantity} {item.unit}
								</span>
							</>
						)}
						{item.expiresAt && (
							<>
								<span>•</span>
								{isExpired ? (
									<span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
										Expired
									</span>
								) : isExpiringSoon ? (
									<span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200">
										Expires soon
									</span>
								) : (
									<span>
										Expires {new Date(item.expiresAt).toLocaleDateString()}
									</span>
								)}
							</>
						)}
					</div>
				</div>

				{showActions && (
					<div className="flex items-center gap-1">
						<Button asChild size="sm" variant="ghost">
							<Link to={`/inventory/${item.id}/edit`}>
								<Icon name="pencil-2" size="sm" />
							</Link>
						</Button>
						<Form method="POST">
							<input type="hidden" name="intent" value="delete" />
							<input type="hidden" name="itemId" value={item.id} />
							<StatusButton
								{...dc.getButtonProps({
									type: 'submit',
									name: 'intent',
									value: 'delete',
								})}
								size="sm"
								variant={dc.doubleCheck ? 'destructive' : 'ghost'}
								status="idle"
								className={dc.doubleCheck ? '' : 'hover:text-destructive'}
							>
								<Icon name="trash" size="sm">
									{dc.doubleCheck ? 'Sure?' : ''}
								</Icon>
							</StatusButton>
						</Form>
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
