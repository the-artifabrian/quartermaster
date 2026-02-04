import { Form } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { type ShoppingListItem } from '@prisma/client'

type ShoppingListItemCardProps = {
	item: ShoppingListItem
}

export function ShoppingListItemCard({ item }: ShoppingListItemCardProps) {
	const dc = useDoubleCheck()

	return (
		<div className="flex items-start gap-3 rounded-lg border bg-card p-3">
			<Form method="POST" className="pt-1">
				<input type="hidden" name="intent" value="toggle" />
				<input type="hidden" name="itemId" value={item.id} />
				<button type="submit" className="cursor-pointer">
					<div
						className={`flex size-5 items-center justify-center rounded border-2 ${
							item.checked
								? 'border-primary bg-primary'
								: 'border-input'
						}`}
					>
						{item.checked && (
							<Icon name="check" size="xs" className="text-primary-foreground" />
						)}
					</div>
				</button>
			</Form>

			<div className="flex-1">
				<p
					className={`font-medium ${item.checked ? 'text-muted-foreground line-through' : ''}`}
				>
					{item.name}
				</p>
				{(item.quantity || item.unit) && (
					<p className="text-sm text-muted-foreground">
						{item.quantity} {item.unit}
					</p>
				)}
			</div>

			<Form method="POST">
				<input type="hidden" name="intent" value="delete" />
				<input type="hidden" name="itemId" value={item.id} />
				<StatusButton
					type="submit"
					variant="ghost"
					size="sm"
					status={dc.doubleCheck ? 'idle' : 'idle'}
					{...dc.getButtonProps()}
				>
					<Icon name="trash" size="sm" />
				</StatusButton>
			</Form>
		</div>
	)
}
