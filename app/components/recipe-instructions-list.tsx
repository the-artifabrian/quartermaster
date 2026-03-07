import { InstructionWithTimers } from '#app/components/instruction-with-timers.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { convertTemperatures } from '#app/utils/metric-conversion.ts'
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
	useMetric,
}: {
	instructions: Array<{ id: string; content: string }>
	checkedSteps: Set<string>
	onToggleStep: (id: string) => void
	substitutions: Map<string, AppliedSubstitution>
	recipeName: string
	useMetric?: boolean
}) {
	function handleToggle(id: string) {
		const wasChecked = checkedSteps.has(id)
		onToggleStep(id)

		// If checking off (not unchecking), scroll to the next unchecked step
		if (!wasChecked) {
			const currentIndex = instructions.findIndex((i) => i.id === id)
			const nextUnchecked = instructions.find(
				(i, idx) => idx > currentIndex && !checkedSteps.has(i.id),
			)
			if (nextUnchecked) {
				requestAnimationFrame(() => {
					const el = document.querySelector(
						`[data-step-id="${nextUnchecked.id}"]`,
					)
					el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
				})
			}
		}
	}

	return (
		<div>
			<h2 className="mb-4 font-serif text-lg font-normal">Instructions</h2>
			<ol className="space-y-1">
				{instructions.map((instruction, index) => {
					const isChecked = checkedSteps.has(instruction.id)
					return (
						<li
							key={instruction.id}
							data-step-id={instruction.id}
							role="checkbox"
							aria-checked={isChecked}
							tabIndex={0}
							className={cn(
								'flex cursor-pointer gap-4 border-b border-border/30 px-1 py-3 transition-all select-none last:border-b-0 print:gap-2 print:border-b-0 print:px-0 print:py-0',
								'focus-visible:ring-primary/50 focus-visible:rounded-lg focus-visible:ring-2 focus-visible:outline-none',
							)}
							onClick={() => handleToggle(instruction.id)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									handleToggle(instruction.id)
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
