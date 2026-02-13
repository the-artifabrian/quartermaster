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
		<div className="bg-card flex items-start gap-3 rounded-lg border p-3 print:border-0 print:p-1">
			<Form method="POST" className="pt-1 print:hidden">
				<input type="hidden" name="intent" value="toggle" />
				<input type="hidden" name="itemId" value={item.id} />
				<button type="submit" className="cursor-pointer p-2.5 -m-2.5">
					<div
						className={`flex size-6 items-center justify-center rounded border-2 ${
							item.checked ? 'border-primary bg-primary' : 'border-input'
						}`}
					>
						{item.checked && (
							<Icon
								name="check"
								size="xs"
								className="text-primary-foreground"
							/>
						)}
					</div>
				</button>
			</Form>
			<span className="hidden pt-0.5 text-base print:inline">
				{item.checked ? '\u2611' : '\u2610'}
			</span>

			<div className="flex-1">
				<p
					className={`font-medium ${item.checked ? 'text-muted-foreground/60 line-through' : ''}`}
				>
					{item.name}
				</p>
				{(item.quantity || item.unit) && (
					<p className="text-muted-foreground text-sm">
						{item.quantity} {item.unit}
					</p>
				)}
			</div>

			<Form method="POST" className="print:hidden">
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
