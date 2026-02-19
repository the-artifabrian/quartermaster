import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import { toast } from 'sonner'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { useModal } from '#app/utils/use-modal.ts'

function ModalShell({
	title,
	onClose,
	children,
}: {
	title: string
	onClose: () => void
	children: React.ReactNode
}) {
	const dialogRef = useModal(onClose)

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby="template-modal-title"
		>
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div className="bg-card shadow-warm-lg relative w-full max-w-md rounded-t-2xl p-6 sm:rounded-2xl">
				<div className="mb-4 flex items-center justify-between">
					<h2
						id="template-modal-title"
						className="font-serif text-xl font-bold"
					>
						{title}
					</h2>
					<button
						onClick={onClose}
						aria-label="Close"
						className="text-muted-foreground hover:text-foreground rounded-md p-1"
					>
						<Icon name="cross-1" size="sm" />
					</button>
				</div>
				{children}
			</div>
		</div>
	)
}

export function SaveTemplateModal({
	weekStart,
	onClose,
}: {
	weekStart: string
	onClose: () => void
}) {
	const fetcher = useFetcher()
	const prevState = useRef(fetcher.state)
	const [name, setName] = useState('')

	useEffect(() => {
		if (
			prevState.current !== 'idle' &&
			fetcher.state === 'idle' &&
			fetcher.data?.status === 'success'
		) {
			toast.success('Template saved')
			onClose()
		}
		prevState.current = fetcher.state
	}, [fetcher.state, fetcher.data, onClose])

	return (
		<ModalShell title="Save as Template" onClose={onClose}>
			<p className="text-muted-foreground mb-4 text-sm">
				Save this week's meal plan as a reusable template.
			</p>
			<fetcher.Form method="POST" action="/resources/meal-plan-templates" className="space-y-4">
				<input type="hidden" name="intent" value="saveTemplate" />
				<input type="hidden" name="weekStart" value={weekStart} />
				<div>
					<label
						htmlFor="templateName"
						className="text-muted-foreground mb-1 block text-sm"
					>
						Template Name
					</label>
					<input
						type="text"
						id="templateName"
						name="name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g., Weeknight Easy, Entertaining Week"
						className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
						autoFocus
						required
					/>
				</div>
				<div className="flex gap-2">
					<Button type="submit" className="flex-1" disabled={!name.trim()}>
						<Icon name="plus" size="sm" />
						Save Template
					</Button>
					<Button type="button" variant="ghost" onClick={onClose}>
						Cancel
					</Button>
				</div>
			</fetcher.Form>
		</ModalShell>
	)
}

type Template = {
	id: string
	name: string
	_count: { entries: number }
}

export function ApplyTemplateModal({
	templates,
	weekStart,
	onClose,
}: {
	templates: Template[]
	weekStart: string
	onClose: () => void
}) {
	const applyFetcher = useFetcher()
	const deleteFetcher = useFetcher()
	const prevApplyState = useRef(applyFetcher.state)
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

	useEffect(() => {
		if (
			prevApplyState.current !== 'idle' &&
			applyFetcher.state === 'idle' &&
			applyFetcher.data?.status === 'success'
		) {
			toast.success('Template applied')
			onClose()
		}
		prevApplyState.current = applyFetcher.state
	}, [applyFetcher.state, applyFetcher.data, onClose])

	// Filter out deleted templates optimistically
	const deletedIds = new Set<string>()
	if (
		deleteFetcher.formData?.get('intent') === 'deleteTemplate' &&
		deleteFetcher.state !== 'idle'
	) {
		const id = deleteFetcher.formData.get('templateId')
		if (typeof id === 'string') deletedIds.add(id)
	}
	const visibleTemplates = templates.filter((t) => !deletedIds.has(t.id))

	return (
		<ModalShell title="Use Template" onClose={onClose}>
			{visibleTemplates.length === 0 ? (
				<p className="text-muted-foreground py-4 text-center text-sm">
					No templates saved yet. Save your current week as a template first.
				</p>
			) : (
				<div className="space-y-2">
					<p className="text-muted-foreground mb-3 text-sm">
						Apply a template to this week. Existing entries won't be duplicated.
					</p>
					{visibleTemplates.map((template) => (
						<div
							key={template.id}
							className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-semibold">
									{template.name}
								</p>
								<p className="text-muted-foreground text-xs">
									{template._count.entries} meal
									{template._count.entries !== 1 ? 's' : ''}
								</p>
							</div>
							<applyFetcher.Form method="POST" action="/resources/meal-plan-templates">
								<input type="hidden" name="intent" value="applyTemplate" />
								<input type="hidden" name="templateId" value={template.id} />
								<input type="hidden" name="weekStart" value={weekStart} />
								<Button type="submit" size="sm">
									Apply
								</Button>
							</applyFetcher.Form>
							{pendingDeleteId === template.id ? (
								<div className="flex gap-1">
									<deleteFetcher.Form method="POST" action="/resources/meal-plan-templates">
										<input type="hidden" name="intent" value="deleteTemplate" />
										<input
											type="hidden"
											name="templateId"
											value={template.id}
										/>
										<Button
											type="submit"
											size="sm"
											variant="destructive"
											onClick={() => setPendingDeleteId(null)}
										>
											Sure?
										</Button>
									</deleteFetcher.Form>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setPendingDeleteId(null)}
									>
										No
									</Button>
								</div>
							) : (
								<Button
									size="sm"
									variant="ghost"
									aria-label="Delete template"
									onClick={() => setPendingDeleteId(template.id)}
								>
									<Icon name="trash" size="sm" />
								</Button>
							)}
						</div>
					))}
				</div>
			)}
			<div className="mt-4">
				<Button variant="ghost" className="w-full" onClick={onClose}>
					Cancel
				</Button>
			</div>
		</ModalShell>
	)
}
