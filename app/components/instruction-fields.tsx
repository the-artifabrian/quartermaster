import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useId } from 'react'
import { useSortableList } from '#app/hooks/use-sortable-list.ts'
import { type RowErrors } from '#app/utils/list-errors.ts'
import { cn } from '#app/utils/misc.tsx'
import { ErrorList, withoutRemoveOffer } from './forms.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Textarea } from './ui/textarea.tsx'

export type InstructionFieldValue = {
	id?: string
	content: string
	/** Stable key for DnD that persists across re-renders */
	sortKey?: string
}

type InstructionFieldsProps = {
	instructions: InstructionFieldValue[]
	onChange: (instructions: InstructionFieldValue[]) => void
	/** Each step's errors by its position, then by field (list-errors.ts). */
	rowErrors?: ReadonlyArray<RowErrors | undefined>
}

function getSortKey() {
	return `sort-${Math.random().toString(36).slice(2)}`
}

function ensureSortKeys(
	instructions: InstructionFieldValue[],
	fallbackPrefix: string,
): InstructionFieldValue[] {
	return instructions.map((ins, index) =>
		ins.sortKey
			? ins
			: { ...ins, sortKey: ins.id ?? `${fallbackPrefix}-${index}` },
	)
}

export function InstructionFields({
	instructions: rawInstructions,
	onChange,
	rowErrors,
}: InstructionFieldsProps) {
	const dndId = useId()
	// Keep untouched initial rows mounted through unrelated form re-renders.
	const instructions = ensureSortKeys(rawInstructions, `${dndId}-instruction`)

	const sortable = useSortableList({
		ids: instructions.map((instruction) => instruction.sortKey!),
		describe: (id) =>
			`step ${instructions.findIndex((step) => step.sortKey === id) + 1}`,
	})

	const addInstruction = () => {
		onChange([...instructions, { content: '', sortKey: getSortKey() }])
	}

	const removeInstruction = (index: number) => {
		if (instructions.length > 1) {
			onChange(instructions.filter((_, i) => i !== index))
		}
	}

	const updateInstruction = (index: number, content: string) => {
		const updated = [...instructions]
		updated[index] = { ...updated[index], content }
		onChange(updated)
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (!over || active.id === over.id) return

		const oldIndex = instructions.findIndex((i) => i.sortKey === active.id)
		const newIndex = instructions.findIndex((i) => i.sortKey === over.id)
		if (oldIndex === -1 || newIndex === -1) return

		const updated = [...instructions]
		const [moved] = updated.splice(oldIndex, 1)
		updated.splice(newIndex, 0, moved!)
		onChange(updated)
	}

	const sortKeys = instructions.map((i) => i.sortKey!)

	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={addInstruction}
				>
					<Icon name="plus" size="sm" />
					Add step
				</Button>
			</div>

			{/* dnd-kit adds its screen reader text after the list once it mounts.
			    Inside the stack it would take the stack's spacing and push the
			    list's end down 16px after the page has drawn. */}
			<div>
				<DndContext
					id={dndId}
					sensors={sortable.sensors}
					accessibility={sortable.accessibility}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={sortKeys}
						strategy={verticalListSortingStrategy}
					>
						<div className="space-y-3">
							{instructions.map((instruction, index) => (
								<SortableInstructionRow
									key={instruction.sortKey}
									sortKey={instruction.sortKey!}
									instruction={instruction}
									errors={rowErrors?.[index]}
									index={index}
									onUpdate={(content) => updateInstruction(index, content)}
									onRemove={() => removeInstruction(index)}
									canRemove={instructions.length > 1}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			</div>
		</div>
	)
}

function SortableInstructionRow({
	sortKey,
	instruction,
	errors,
	index,
	onUpdate,
	onRemove,
	canRemove,
}: {
	sortKey: string
	instruction: InstructionFieldValue
	errors?: RowErrors
	index: number
	onUpdate: (content: string) => void
	onRemove: () => void
	canRemove: boolean
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: sortKey })
	const errorId = `${useId()}-errors`
	const messages = (errors ? Object.values(errors).flat() : []).map(
		(message) => (canRemove ? message : withoutRemoveOffer(message)),
	)

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				'flex gap-3',
				isDragging && 'shadow-warm-lg z-10 opacity-80',
			)}
		>
			<div className="flex shrink-0 flex-col items-center gap-1 pt-1">
				<button
					type="button"
					// 44px to grab with a thumb; the negative margins keep the
					// step column as narrow as its number, and it sits above the
					// number it overlaps. Hold to pick up; a swipe still scrolls.
					className="text-muted-foreground/70 hover:text-muted-foreground active:bg-muted relative z-10 -mx-2 -my-2.5 flex size-11 cursor-grab touch-manipulation items-center justify-center rounded-md select-none active:cursor-grabbing"
					aria-label={`Reorder step ${index + 1}`}
					{...attributes}
					{...listeners}
				>
					<Icon name="dots-horizontal" size="sm" />
				</button>
				<div className="bg-primary-fill text-primary-foreground flex size-7 items-center justify-center rounded-full text-sm font-medium sm:size-8">
					{index + 1}
				</div>
			</div>
			<div className="flex-1">
				<Textarea
					placeholder={`Step ${index + 1}`}
					aria-label={`Step ${index + 1}`}
					aria-invalid={messages.length ? true : undefined}
					aria-describedby={messages.length ? errorId : undefined}
					value={instruction.content}
					onChange={(e) => onUpdate(e.target.value)}
					rows={2}
					className="[field-sizing:content] resize-none"
				/>
				{messages.length ? (
					<div className="pt-1">
						<ErrorList id={errorId} errors={messages} />
					</div>
				) : null}
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={onRemove}
				disabled={!canRemove}
				className={cn(!canRemove && 'opacity-30')}
				aria-label="Remove step"
			>
				<Icon name="cross-1" size="sm" />
			</Button>
		</div>
	)
}
