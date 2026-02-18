import { format } from 'date-fns'
import { Form } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { useDoubleCheck } from '#app/utils/misc.tsx'

export function CookingLogEntry({
	log,
}: {
	log: {
		id: string
		cookedAt: Date
		notes: string | null
	}
}) {
	const dc = useDoubleCheck()

	return (
		<div className="bg-card shadow-warm flex items-start gap-3 rounded-2xl border p-4">
			<div className="min-w-0 flex-1">
				<span className="text-sm font-medium">
					{format(new Date(log.cookedAt), 'MMM d, yyyy')}
				</span>
				{log.notes && (
					<p className="text-muted-foreground mt-1 text-sm">{log.notes}</p>
				)}
			</div>
			<Form method="POST">
				<input type="hidden" name="intent" value="deleteCookLog" />
				<input type="hidden" name="logId" value={log.id} />
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
					})}
					size="sm"
					variant={dc.doubleCheck ? 'destructive' : 'ghost'}
					status="idle"
				>
					<Icon name="trash" size="sm">
						{dc.doubleCheck ? 'Sure?' : ''}
					</Icon>
				</StatusButton>
			</Form>
		</div>
	)
}
