import { InlineTemperature } from '#app/components/inline-temperature.tsx'
import {
	detectTemperatures,
	type TemperatureMatch,
} from '#app/utils/temperature-detection.ts'
import { detectTimes, type TimeMatch } from '#app/utils/time-detection.ts'

export type CookingCueMatch =
	| { type: 'duration'; match: TimeMatch }
	| { type: 'temperature'; match: TemperatureMatch }

/**
 * Keep cue rendering deterministic if detectors ever return overlapping text.
 * The earliest match wins; matches with the same start prefer the longest span,
 * then temperature conversion over passive duration styling.
 */
export function selectNonOverlappingCookingCues(
	cues: CookingCueMatch[],
): CookingCueMatch[] {
	const sorted = [...cues].sort((a, b) => {
		const startDifference = a.match.startIndex - b.match.startIndex
		if (startDifference !== 0) return startDifference

		const lengthDifference =
			b.match.endIndex -
			b.match.startIndex -
			(a.match.endIndex - a.match.startIndex)
		if (lengthDifference !== 0) return lengthDifference

		return a.type === b.type ? 0 : a.type === 'temperature' ? -1 : 1
	})

	const selected: CookingCueMatch[] = []
	let lastIndex = 0
	for (const cue of sorted) {
		if (cue.match.startIndex < lastIndex) continue
		selected.push(cue)
		lastIndex = cue.match.endIndex
	}
	return selected
}

export function InstructionWithCookingCues({ content }: { content: string }) {
	const cues = selectNonOverlappingCookingCues([
		...detectTimes(content).map((match) => ({
			type: 'duration' as const,
			match,
		})),
		...detectTemperatures(content).map((match) => ({
			type: 'temperature' as const,
			match,
		})),
	])

	if (cues.length === 0) return <>{content}</>

	const parts: React.ReactNode[] = []
	let lastIndex = 0

	for (const cue of cues) {
		const { startIndex, endIndex } = cue.match
		if (startIndex > lastIndex) parts.push(content.slice(lastIndex, startIndex))

		if (cue.type === 'duration') {
			parts.push(
				<span
					key={`duration-${startIndex}-${endIndex}`}
					data-cooking-cue="duration"
					data-testid="cooking-duration-cue"
					className="text-primary decoration-primary/40 font-semibold underline decoration-2 underline-offset-4 print:text-inherit print:no-underline"
				>
					{content.slice(startIndex, endIndex)}
				</span>,
			)
		} else {
			parts.push(
				<InlineTemperature
					key={`temperature-${startIndex}-${endIndex}`}
					originalText={cue.match.originalText}
					converted={cue.match.converted}
				/>,
			)
		}

		lastIndex = endIndex
	}

	if (lastIndex < content.length) parts.push(content.slice(lastIndex))

	return <span>{parts}</span>
}
