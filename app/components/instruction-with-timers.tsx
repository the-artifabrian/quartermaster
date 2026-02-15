import { InlineTemperature } from '#app/components/inline-temperature.tsx'
import { InlineTimerButton } from '#app/components/inline-timer-button.tsx'
import {
	detectTemperatures,
	type TemperatureMatch,
} from '#app/utils/temperature-detection.ts'
import { detectTimes, type TimeMatch } from '#app/utils/time-detection.ts'

type AnnotationMatch =
	| { type: 'time'; match: TimeMatch }
	| { type: 'temperature'; match: TemperatureMatch }

export function InstructionWithTimers({
	content,
	stepNumber,
	recipeName,
}: {
	content: string
	stepNumber: number
	recipeName: string
}) {
	const timeMatches = detectTimes(content)
	const tempMatches = detectTemperatures(content)

	// Merge all matches by position
	const annotations: AnnotationMatch[] = [
		...timeMatches.map((m) => ({ type: 'time' as const, match: m })),
		...tempMatches.map((m) => ({ type: 'temperature' as const, match: m })),
	].sort((a, b) => a.match.startIndex - b.match.startIndex)

	if (annotations.length === 0) {
		return <>{content}</>
	}

	// Split text at match boundaries and interleave inline widgets
	const parts: React.ReactNode[] = []
	let lastIndex = 0

	for (let i = 0; i < annotations.length; i++) {
		const annotation = annotations[i]!
		const { startIndex, endIndex } = annotation.match

		// Skip overlapping matches
		if (startIndex < lastIndex) continue

		// Text before this match
		if (startIndex > lastIndex) {
			parts.push(content.slice(lastIndex, startIndex))
		}

		if (annotation.type === 'time') {
			// The matched text itself
			parts.push(content.slice(startIndex, endIndex))

			// Timer button after the matched text
			parts.push(
				<InlineTimerButton
					key={`timer-${i}`}
					durationSeconds={annotation.match.durationSeconds}
					label={annotation.match.label}
					stepNumber={stepNumber}
					recipeName={recipeName}
				/>,
			)
		} else {
			// Temperature: replace matched text with tooltip component
			parts.push(
				<InlineTemperature
					key={`temp-${i}`}
					originalText={annotation.match.originalText}
					converted={annotation.match.converted}
				/>,
			)
		}

		lastIndex = endIndex
	}

	// Remaining text after last match
	if (lastIndex < content.length) {
		parts.push(content.slice(lastIndex))
	}

	return <span>{parts}</span>
}
