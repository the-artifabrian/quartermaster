import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from '@dnd-kit/core'
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Textarea } from './ui/textarea.tsx'

export type InstructionFieldValue = {
	id?: string
	content: string
	/** Stable key for DnD — persists across re-renders */
	sortKey?: string
}

type InstructionFieldsProps = {
	instructions: InstructionFieldValue[]
	onChange: (instructions: InstructionFieldValue[]) => void
}

function getSortKey() {
	return `sort-${Math.random().toString(36).slice(2)}`
}

function ensureSortKeys(
	instructions: InstructionFieldValue[],
): InstructionFieldValue[] {
	return instructions.map((ins) =>
		ins.sortKey ? ins : { ...ins, sortKey: ins.id ?? getSortKey() },
	)
}

export function InstructionFields({
	instructions: rawInstructions,
	onChange,
}: InstructionFieldsProps) {
	const instructions = ensureSortKeys(rawInstructions)

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

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
					Add Step
				</Button>
			</div>

			<DndContext
				sensors={sensors}
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
								index={index}
								onUpdate={(content) =>
									updateInstruction(index, content)
								}
								onRemove={() => removeInstruction(index)}
								canRemove={instructions.length > 1}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	)
}

function SortableInstructionRow({
	sortKey,
	instruction,
	index,
	onUpdate,
	onRemove,
	canRemove,
}: {
	sortKey: string
	instruction: InstructionFieldValue
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
				isDragging && 'z-10 opacity-80 shadow-lg',
			)}
		>
			<div className="flex shrink-0 flex-col items-center gap-1 pt-1">
				<button
					type="button"
					className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab touch-none active:cursor-grabbing"
					{...attributes}
					{...listeners}
					tabIndex={-1}
				>
					<Icon name="dots-horizontal" size="sm" />
				</button>
				<div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full text-sm font-medium sm:size-8">
					{index + 1}
				</div>
			</div>
			<div className="flex-1">
				<Textarea
					placeholder={`Step ${index + 1}`}
					value={instruction.content}
					onChange={(e) => onUpdate(e.target.value)}
					rows={2}
					className="resize-none"
				/>
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
