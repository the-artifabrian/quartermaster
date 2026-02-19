import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import {
	type AppliedSubstitution,
	applySubstitutionsToText,
} from '#app/utils/recipe-detail.ts'

export function RecipeInstructionsList({
	instructions,
	checkedSteps,
	onToggleStep,
	substitutions,
	recipeName,
}: {
	instructions: Array<{ id: string; content: string }>
	checkedSteps: Set<string>
	onToggleStep: (id: string) => void
	substitutions: Map<string, AppliedSubstitution>
	recipeName: string
}) {
	return (
		<div>
			<h2 className="mb-4 text-lg font-semibold">Instructions</h2>
			<ol className="space-y-4">
				{instructions.map((instruction, index) => {
					const isChecked = checkedSteps.has(instruction.id)
					return (
						<li
							key={instruction.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer gap-4 rounded-lg px-3 py-3 transition-all select-none',
								'hover:bg-muted/50',
								'focus-visible:ring-primary/50 focus-visible:outline-none focus-visible:ring-2',
							)}
							onClick={() => onToggleStep(instruction.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									onToggleStep(instruction.id)
								}
							}}
						>
							<span
								className={cn(
									'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
									isChecked
										? 'bg-primary/20 text-primary'
										: 'bg-accent/10 text-accent border-accent/20 border',
								)}
							>
								{isChecked ? <Icon name="check" size="sm" /> : index + 1}
							</span>
							<p
								className={cn(
									'pt-1 text-base transition-colors',
									isChecked && 'text-muted-foreground/50 line-through',
								)}
							>
								<InstructionWithTimers
									content={
										substitutions.size > 0
											? applySubstitutionsToText(
													instruction.content,
													substitutions,
												)
											: instruction.content
									}
									stepNumber={index + 1}
									recipeName={recipeName}
								/>
							</p>
						</li>
					)
				})}
			</ol>
		</div>
	)
}
