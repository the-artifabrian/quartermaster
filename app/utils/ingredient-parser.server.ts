// Re-export shared parsing utilities (available client-side too)
export { COMMON_UNITS, parseIngredient } from './ingredient-parser.ts'

// Convert ISO 8601 duration (PT30M, PT1H15M) to minutes
export function parseISODuration(duration: string): number | undefined {
	if (!duration) return undefined

	const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
	if (!match) return undefined

	const hours = parseInt(match[1] || '0', 10)
	const minutes = parseInt(match[2] || '0', 10)
	const seconds = parseInt(match[3] || '0', 10)

	const total = hours * 60 + minutes + (seconds > 0 ? 1 : 0)
	return total > 0 ? total : undefined
}
