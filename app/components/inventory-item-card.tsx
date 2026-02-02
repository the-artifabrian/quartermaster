import { type InventoryItem } from '@prisma/client'
import { Form, Link } from 'react-router'
import { LOCATION_LABELS } from '#app/utils/inventory-validation.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { StatusButton } from './ui/status-button.tsx'

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
		item.expiresAt && new Date(item.expiresAt) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
	const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date()

	return (
		<div className="group rounded-lg border bg-card text-card-foreground shadow-sm">
			<div className="flex items-start justify-between gap-2 p-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="font-semibold line-clamp-1">{item.name}</h3>
						{item.lowStock && (
							<span className="flex items-center gap-1 text-xs text-orange-600">
								<Icon name="question-mark-circled" size="xs" />
								Low
							</span>
						)}
					</div>

					<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span className="capitalize">
							{LOCATION_LABELS[item.location as keyof typeof LOCATION_LABELS]}
						</span>
						{item.quantity && (
							<>
								<span>•</span>
								<span>
									{item.quantity} {item.unit}
								</span>
							</>
						)}
						{item.expiresAt && (
							<>
								<span>•</span>
								<span
									className={
										isExpired
											? 'text-red-600 font-medium'
											: isExpiringSoon
												? 'text-orange-600 font-medium'
												: ''
									}
								>
									{isExpired
										? 'Expired'
										: isExpiringSoon
											? 'Expires soon'
											: `Expires ${new Date(item.expiresAt).toLocaleDateString()}`}
								</span>
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

export function InventoryItemGrid({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
			{children}
		</div>
	)
}
