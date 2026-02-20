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
			<h2 className="mb-4 font-serif text-lg font-normal">Instructions</h2>
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
								'flex cursor-pointer gap-4 px-1 py-2 transition-all select-none',
								'focus-visible:ring-primary/50 focus-visible:rounded-lg focus-visible:ring-2 focus-visible:outline-none',
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
									'font-serif flex size-8 shrink-0 items-center justify-center text-[1.5rem] leading-none font-normal transition-colors',
									isChecked
										? 'text-primary/40'
										: 'text-muted-foreground',
								)}
							>
								{isChecked ? <Icon name="check" className="size-5 text-primary" /> : index + 1}
							</span>
							<p
								className={cn(
									'pt-0.5 text-[1.0625rem] leading-[1.75] transition-colors md:text-base md:leading-[1.75]',
									isChecked && 'text-muted-foreground/40 line-through decoration-muted-foreground/30',
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
