import { InlineTimerButton } from '#app/components/inline-timer-button.tsx'
import { detectTimes } from '#app/utils/time-detection.ts'

export function InstructionWithTimers({
	content,
	stepNumber,
	recipeName,
}: {
	content: string
	stepNumber: number
	recipeName: string
}) {
	const matches = detectTimes(content)

	if (matches.length === 0) {
		return <>{content}</>
	}

	// Split text at match boundaries and interleave timer buttons
	const parts: React.ReactNode[] = []
	let lastIndex = 0

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i]!

		// Text before this match
		if (match.startIndex > lastIndex) {
			parts.push(content.slice(lastIndex, match.startIndex))
		}

		// The matched text itself
		parts.push(content.slice(match.startIndex, match.endIndex))

		// Timer button after the matched text
		parts.push(
			<InlineTimerButton
				key={`timer-${i}`}
				durationSeconds={match.durationSeconds}
				label={match.label}
				stepNumber={stepNumber}
				recipeName={recipeName}
			/>,
		)

		lastIndex = match.endIndex
	}

	// Remaining text after last match
	if (lastIndex < content.length) {
		parts.push(content.slice(lastIndex))
	}

	return <span>{parts}</span>
}
