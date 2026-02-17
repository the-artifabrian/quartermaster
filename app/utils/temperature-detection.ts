export type TemperatureMatch = {
	originalText: string
	value: number
	/** Upper bound if this is a range, null if not a range */
	valueHigh: number | null
	unit: 'F' | 'C'
	converted: string
	startIndex: number
	endIndex: number
}

function fToC(f: number): number {
	return (f - 32) * (5 / 9)
}

function cToF(c: number): number {
	return c * (9 / 5) + 32
}

/** Round to the nearest 5 for clean display (175°C not 176.67°C) */
function roundTemp(temp: number): number {
	return Math.round(temp / 5) * 5
}

function formatConverted(match: {
	value: number
	valueHigh: number | null
	unit: 'F' | 'C'
}): string {
	const convert = match.unit === 'F' ? fToC : cToF
	const targetUnit = match.unit === 'F' ? 'C' : 'F'

	const low = roundTemp(convert(match.value))

	if (match.valueHigh !== null) {
		const high = roundTemp(convert(match.valueHigh))
		if (low === high) return `${low}°${targetUnit}`
		return `${low}–${high}°${targetUnit}`
	}

	return `${low}°${targetUnit}`
}

// Window size for checking if the opposite unit is already nearby
const BOTH_UNITS_WINDOW = 30

/**
 * Detects temperature references in instruction text and returns structured matches.
 */
export function detectTemperatures(text: string): TemperatureMatch[] {
	const matches: TemperatureMatch[] = []

	// Regex created inside the function to avoid shared mutable lastIndex state.
	// The degree separator (°, º, "degrees") is optional to match bare "350F"/"175C".
	// Sanity bounds below filter out false positives from the bare form.
	const pattern =
		/(\d+)\s*(?:[-–]\s*(\d+)\s*)?(?:°\s*|degrees?\s+|º\s*)?(F(?:ahrenheit)?|C(?:elsius|entigrade)?)\b/gi

	let m
	while ((m = pattern.exec(text)) !== null) {
		const unit: 'F' | 'C' = m[3]!.toUpperCase().startsWith('F') ? 'F' : 'C'
		const value = parseInt(m[1]!, 10)
		const valueHigh = m[2] ? parseInt(m[2], 10) : null

		// For bare form (no ° or "degrees"), require 3+ digit number to avoid
		// false positives like "section 3C" or "vitamin C"
		const hasSeparator = /[°º]|degrees?/i.test(
			m[0].slice(m[1]!.length, -m[3]!.length),
		)
		if (!hasSeparator && m[1]!.length < 3) continue

		// Skip if the opposite unit appears nearby (both already provided)
		const oppositeUnit = unit === 'F' ? 'C' : 'F'
		const after = text.slice(
			m.index + m[0].length,
			m.index + m[0].length + BOTH_UNITS_WINDOW,
		)
		const before = text.slice(Math.max(0, m.index - BOTH_UNITS_WINDOW), m.index)
		const oppositePattern = new RegExp(
			`\\d+\\s*(?:°\\s*|degrees?\\s+)${oppositeUnit}`,
			'i',
		)
		if (oppositePattern.test(after) || oppositePattern.test(before)) continue

		// Sanity check: skip unreasonable temps
		if (unit === 'F' && (value < 100 || value > 1000)) continue
		if (unit === 'C' && (value < 30 || value > 550)) continue

		matches.push({
			originalText: m[0],
			value,
			valueHigh,
			unit,
			converted: formatConverted({ value, valueHigh, unit }),
			startIndex: m.index,
			endIndex: m.index + m[0].length,
		})
	}

	// Sort by position in text
	matches.sort((a, b) => a.startIndex - b.startIndex)

	return matches
}
