import { InstructionWithCookingCues } from '#app/components/instruction-with-cooking-cues.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { convertTemperatures } from '#app/utils/metric-conversion.ts'
import { cn } from '#app/utils/misc.tsx'

export function RecipeInstructionsList({
	instructions,
	checkedSteps,
	onToggleStep,
	useMetric,
}: {
	instructions: Array<{ id: string; content: string }>
	checkedSteps: Set<string>
	onToggleStep: (id: string) => void
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
			<h2 className="phone:text-recipe-section phone:mb-1.5 mb-4 font-serif text-lg">
				Instructions
			</h2>
			<ol className="phone:space-y-0 space-y-1">
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
								'border-border/30 flex cursor-pointer gap-3 border-b py-3 transition-colors select-none last:border-b-0 print:gap-2 print:border-b-0 print:px-0 print:py-0',
								// A phone sets the numeral large in its own column, as wide as
								// an ingredient's circle and its gap, so the texts line up.
								'phone:border-border phone:grid phone:grid-cols-[2.25rem_minmax(0,1fr)] phone:gap-0 phone:py-3.5',
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
								data-step-number=""
								className={cn(
									// The width of an ingredient's checkbox, so steps and ingredients
									// share their columns.
									'flex h-8 w-6 shrink-0 items-center justify-center font-serif text-xl leading-none transition-colors print:size-5 print:text-sm',
									// As tall as the text's first line, the numeral and the check
									// centred on it.
									'phone:text-step-number phone:h-[1.7rem] phone:w-auto phone:justify-start phone:font-normal',
									isChecked
										? 'text-faint'
										: 'text-muted-foreground phone:text-primary',
								)}
							>
								{isChecked ? (
									<>
										<Icon
											name="check"
											className="text-primary phone:size-6 size-5 print:hidden"
										/>
										<span className="hidden print:inline">{index + 1}</span>
									</>
								) : (
									index + 1
								)}
							</span>
							<p
								data-step-text=""
								className={cn(
									// The size's own line height: `leading-*` below would win over it.
									'phone:text-step phone:leading-(--text-step--line-height) phone:pt-0',
									'pt-0.5 text-[1.0625rem] leading-[1.75] text-pretty transition-colors md:text-base md:leading-[1.75] print:pt-0 print:text-sm print:leading-[1.5]',
									isChecked &&
										'text-faint decoration-faint/60 phone:no-underline line-through',
								)}
							>
								<InstructionWithCookingCues
									content={
										useMetric
											? convertTemperatures(instruction.content)
											: instruction.content
									}
									isChecked={isChecked}
								/>
							</p>
						</li>
					)
				})}
			</ol>
		</div>
	)
}
