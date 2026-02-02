import { useId } from 'react'
import { cn } from '#app/utils/misc.tsx'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'
import { Label } from './ui/label.tsx'
import { Textarea } from './ui/textarea.tsx'

export type InstructionFieldValue = {
	id?: string
	content: string
}

type InstructionFieldsProps = {
	instructions: InstructionFieldValue[]
	onChange: (instructions: InstructionFieldValue[]) => void
	errors?: Record<string, string[] | undefined>
}

export function InstructionFields({
	instructions,
	onChange,
	errors,
}: InstructionFieldsProps) {
	const baseId = useId()

	const addInstruction = () => {
		onChange([...instructions, { content: '' }])
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

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<Label className="text-base font-semibold">Instructions</Label>
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

			<div className="space-y-4">
				{instructions.map((instruction, index) => {
					const error = errors?.[`instructions[${index}].content`]
					return (
						<div
							key={instruction.id ?? `${baseId}-${index}`}
							className="flex gap-3"
						>
							<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
								{index + 1}
							</div>
							<div className="flex-1 space-y-1">
								<Textarea
									name={`instructions[${index}].content`}
									placeholder={`Step ${index + 1}`}
									value={instruction.content}
									onChange={(e) => updateInstruction(index, e.target.value)}
									aria-invalid={error ? true : undefined}
									rows={2}
									className="resize-none"
								/>
								{error && (
									<p className="text-xs text-destructive">{error.join(', ')}</p>
								)}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => removeInstruction(index)}
								disabled={instructions.length <= 1}
								className={cn(instructions.length <= 1 && 'opacity-30')}
								aria-label="Remove step"
							>
								<Icon name="cross-1" size="sm" />
							</Button>
						</div>
					)
				})}
			</div>
		</div>
	)
}
