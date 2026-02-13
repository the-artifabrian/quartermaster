// Common cooking units - only these should be treated as units
export const COMMON_UNITS = new Set([
	'g',
	'kg',
	'mg',
	'oz',
	'lb',
	'lbs',
	'pound',
	'pounds',
	'ml',
	'l',
	'liter',
	'liters',
	'litre',
	'litres',
	'gallon',
	'gallons',
	'quart',
	'quarts',
	'pint',
	'pints',
	'cup',
	'cups',
	'tablespoon',
	'tablespoons',
	'tbsp',
	'tsp',
	'teaspoon',
	'teaspoons',
	'can',
	'cans',
	'jar',
	'jars',
	'bottle',
	'bottles',
	'package',
	'packages',
	'box',
	'boxes',
	'slice',
	'slices',
	'piece',
	'pieces',
	'whole',
	'half',
	'halves',
	'clove',
	'cloves',
	'bunch',
	'bunches',
	'head',
	'heads',
	'stalk',
	'stalks',
	'sprig',
	'sprigs',
	'pinch',
	'dash',
	'handful',
])

// Parse an ingredient string into structured parts
export function parseIngredient(line: string): {
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
} | null {
	const cleaned = line
		.replace(/^-\s*\[[ x]\]\s*/, '')
		.replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim()
	if (!cleaned) return null

	// Handle "X to taste" pattern (without comma).
	// Only match when not starting with a digit (avoids capturing "2 tsp salt to taste"
	// which should fall through to the main regex for proper amount/unit parsing).
	const toTasteMatch = cleaned.match(/^([a-zA-Z][^,]*?)\s+to\s+taste$/i)
	if (toTasteMatch) {
		return { name: toTasteMatch[1]!.trim(), notes: 'to taste' }
	}

	// Handle "N (X unit) container name" → e.g. "1 (14.5 oz) can diced tomatoes"
	const nestedMatch = cleaned.match(
		/^([\d.\/\-–½⅓⅔¼¾⅛~]+)\s*\(([^)]+)\)\s*([a-zA-Z]+)\s+(.+)$/,
	)
	if (nestedMatch) {
		const [, nestedAmount, parenthetical, possibleUnit, rest] = nestedMatch
		if (possibleUnit && COMMON_UNITS.has(possibleUnit.toLowerCase())) {
			let name = rest!.trim()
			let notes: string | undefined = parenthetical!.trim()
			if (name.includes(',')) {
				const parts = name.split(',').map((s) => s.trim())
				name = parts[0]!
				notes = notes + '; ' + parts.slice(1).join(', ')
			}
			return { name, amount: nestedAmount, unit: possibleUnit, notes }
		}
	}

	// Try to match: amount + optional unit + name
	// Handle both "600 g broccoli" and "600g broccoli"
	const match = cleaned.match(
		/^(~?[\d.\/\-–½⅓⅔¼¾⅛]+)\s*([a-zA-Z]+)?\s+(.+)$/,
	)

	if (match) {
		const amount = match[1]
		const possibleUnit = match[2]
		let remainder = match[3]?.trim() || ''
		let unit: string | undefined = undefined
		let name = ''
		let notes: string | undefined = undefined

		// Check if the matched word is a valid unit
		if (possibleUnit && COMMON_UNITS.has(possibleUnit.toLowerCase())) {
			unit = possibleUnit
			name = remainder
		} else if (possibleUnit) {
			// If it's not a valid unit, it's part of the ingredient name
			name = possibleUnit + ' ' + remainder
		} else {
			// Check if the first word of remainder is a valid unit
			const words = remainder.split(/\s+/)
			if (
				words.length > 1 &&
				words[0] &&
				COMMON_UNITS.has(words[0].toLowerCase())
			) {
				unit = words[0]
				name = words.slice(1).join(' ')
			} else {
				name = remainder
			}
		}

		// Split name on comma to extract notes
		if (name && name.includes(',')) {
			const parts = name.split(',').map((s) => s.trim())
			name = parts[0] || ''
			notes = parts.slice(1).join(', ')
		}

		return { name: name?.trim() || '', amount, unit, notes }
	}

	// For ingredients without amounts, also check for comma-separated notes
	let name = cleaned
	let notes: string | undefined = undefined

	if (cleaned.includes(',')) {
		const parts = cleaned.split(',').map((s) => s.trim())
		name = parts[0] || ''
		notes = parts.slice(1).join(', ')
	}

	return { name, notes }
}
