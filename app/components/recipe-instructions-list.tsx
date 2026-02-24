import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { cn } from '#app/utils/misc.tsx'
import { convertTemperatures } from '#app/utils/metric-conversion.ts'
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
	useMetric,
}: {
	instructions: Array<{ id: string; content: string }>
	checkedSteps: Set<string>
	onToggleStep: (id: string) => void
	substitutions: Map<string, AppliedSubstitution>
	recipeName: string
	useMetric?: boolean
}) {
	return (
		<div>
			<h2 className="mb-4 font-serif text-lg font-normal">Instructions</h2>
			<ol className="space-y-2">
				{instructions.map((instruction, index) => {
					const isChecked = checkedSteps.has(instruction.id)
					return (
						<li
							key={instruction.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer gap-4 px-1 py-2 transition-all select-none print:gap-2 print:px-0 print:py-0',
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
									'flex size-8 shrink-0 items-center justify-center font-serif text-xl leading-none font-normal transition-colors print:size-5 print:text-sm',
									isChecked ? 'text-primary/40' : 'text-muted-foreground',
								)}
							>
								{isChecked ? (
									<>
										<Icon
											name="check"
											className="text-primary size-5 print:hidden"
										/>
										<span className="hidden print:inline">{index + 1}</span>
									</>
								) : (
									index + 1
								)}
							</span>
							<p
								className={cn(
									'pt-0.5 text-[1.0625rem] leading-[1.75] transition-colors md:text-base md:leading-[1.75] print:pt-0 print:text-sm print:leading-[1.5]',
									isChecked &&
										'text-muted-foreground/40 decoration-muted-foreground/30 line-through',
								)}
							>
								<InstructionWithTimers
									content={(() => {
										let c =
											substitutions.size > 0
												? applySubstitutionsToText(
														instruction.content,
														substitutions,
													)
												: instruction.content
										if (useMetric) c = convertTemperatures(c)
										return c
									})()}
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
