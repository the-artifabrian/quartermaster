// Common cooking units - only these should be treated as units
export const COMMON_UNITS = new Set([
	'g',
	'gram',
	'grams',
	'kg',
	'kilogram',
	'kilograms',
	'kgs',
	'mg',
	'milligram',
	'milligrams',
	'oz',
	'ounce',
	'ounces',
	'ozs',
	'lb',
	'lbs',
	'pound',
	'pounds',
	'ml',
	'mls',
	'milliliter',
	'milliliters',
	'millilitre',
	'millilitres',
	'l',
	'liter',
	'liters',
	'litre',
	'litres',
	'gallon',
	'gallons',
	'gal',
	'quart',
	'quarts',
	'qt',
	'qts',
	'pint',
	'pints',
	'pt',
	'pts',
	'cup',
	'cups',
	'tablespoon',
	'tablespoons',
	'tbsp',
	'tbsps',
	'tsp',
	'tsps',
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
	'stick',
	'sticks',
	'pinch',
	'dash',
	'handful',
])

// Helpers for period-tolerant unit matching (e.g. "tbsp." → "tbsp")
function isUnit(word: string): boolean {
	const normalized = word.replace(/\.$/, '').toLowerCase()
	return COMMON_UNITS.has(normalized)
}

function stripUnitPeriod(word: string): string {
	return word.replace(/\.$/, '')
}

// Written-out numbers for pre-processing
const NUMBER_WORDS: Record<string, string> = {
	one: '1',
	two: '2',
	three: '3',
	four: '4',
	five: '5',
	six: '6',
	seven: '7',
	eight: '8',
	nine: '9',
	ten: '10',
	eleven: '11',
	twelve: '12',
}

/**
 * Remove unmatched parentheses from text.
 * Handles broken HTML that produces orphaned ) or ( in ingredient strings.
 */
function stripOrphanedParens(text: string): string {
	// Pass 1: left-to-right, remove orphaned )
	let depth = 0
	let result = ''
	for (const ch of text) {
		if (ch === '(') {
			depth++
			result += ch
		} else if (ch === ')') {
			if (depth > 0) {
				depth--
				result += ch
			}
			// orphaned ), skip
		} else {
			result += ch
		}
	}
	// Pass 2: right-to-left, remove orphaned (
	if (depth > 0) {
		let result2 = ''
		for (let i = result.length - 1; i >= 0; i--) {
			if (result[i] === '(' && depth > 0) {
				depth--
			} else {
				result2 = result[i] + result2
			}
		}
		return result2.replace(/\s{2,}/g, ' ').trim()
	}
	return result
}

/**
 * Determine if a word is an ingredient descriptor that should stay in the name
 * rather than being treated as the start of prep notes after a comma.
 * e.g., "boneless, skinless chicken breasts" — "skinless" is a descriptor.
 */
function isIngredientDescriptor(word: string): boolean {
	const w = word.toLowerCase()
	return w.endsWith('less') || w.endsWith('-free')
}

/**
 * Split comma-separated text into name and notes, keeping ingredient
 * descriptors (like "boneless, skinless") as part of the name.
 */
function splitNameNotes(text: string): {
	name: string
	notes: string | undefined
} {
	const parts = text.split(',').map((s) => s.trim())
	let splitIndex = 1
	for (let i = 1; i < parts.length; i++) {
		const firstWord = parts[i]?.split(/\s+/)[0] || ''
		if (isIngredientDescriptor(firstWord)) {
			splitIndex = i + 1
		} else {
			break
		}
	}
	const name = stripOrphanedParens(parts.slice(0, splitIndex).join(', '))
	const rawNotes =
		splitIndex < parts.length
			? parts.slice(splitIndex).join(', ')
			: undefined
	const notes = rawNotes ? stripOrphanedParens(rawNotes) : undefined
	return { name, notes }
}

/**
 * Extract trailing parenthetical from ingredient name into notes.
 * "cream cheese (at room temp)" → { name: "cream cheese", extracted: "at room temp" }
 * "olive oil (or vegetable oil)" → { name: "olive oil", extracted: "or vegetable oil" }
 */
function extractTrailingParenthetical(
	name: string,
	existingNotes: string | undefined,
): { name: string; notes: string | undefined } {
	const parenMatch = name.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
	if (parenMatch) {
		const extracted = parenMatch[2]!.trim()
		return {
			name: parenMatch[1]!.trim(),
			notes: existingNotes ? existingNotes + ', ' + extracted : extracted,
		}
	}
	return { name, notes: existingNotes }
}

// Parse an ingredient string into structured parts
export function parseIngredient(line: string): {
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
} | null {
	let cleaned = line
		.replace(/^-\s*\[[ x]\]\s*/, '')
		.replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.trim()
	if (!cleaned) return null

	// Strip redundant parens after commas: "beans, (trimmed)" → "beans, trimmed"
	// Common in JSON-LD recipeIngredient data from recipe sites
	cleaned = cleaned.replace(/,\s*\(([^)]+)\)/g, ', $1')

	// Fix broken parenthetical fragments from poorly-formatted JSON-LD:
	// "chicken cutlets, sliced thin), (approx." → "chicken cutlets, sliced thin, approx."
	cleaned = cleaned.replace(/\)\s*,\s*\(/g, ', ')

	// Strip double parentheses: "((I like to use panko))" → "(I like to use panko)"
	cleaned = cleaned.replace(/\(\(([^)]+)\)\)/g, '($1)')

	// Strip orphaned parentheses from broken HTML/JSON-LD
	cleaned = stripOrphanedParens(cleaned)

	// Strip "about"/"approximately" prefix: "about 2 cups flour" → "2 cups flour"
	cleaned = cleaned.replace(/^(?:about|approximately)\s+/i, '')

	// Strip parenthetical approximation markers: "(approx.)" / "(approximately)"
	cleaned = cleaned.replace(/\s*\(approx\.?\)/gi, '')
	cleaned = cleaned.replace(/\s*\(approximately\)/gi, '')

	// Written-out numbers: "Two cloves garlic" → "2 cloves garlic"
	const wordNumMatch = cleaned.match(
		/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s+/i,
	)
	if (wordNumMatch) {
		cleaned =
			NUMBER_WORDS[wordNumMatch[1]!.toLowerCase()]! +
			' ' +
			cleaned.slice(wordNumMatch[0].length)
	}

	// "Juice of" / "Zest of" patterns: "Juice of 1 lemon" → "1 lemon, juice"
	const juiceZestMatch = cleaned.match(
		/^(juice|zest|juice\s+and\s+zest)\s+of\s+([\d½⅓⅔¼¾⅛⅜⅝⅞\/]+)\s+(.+)$/i,
	)
	if (juiceZestMatch) {
		const descriptor = juiceZestMatch[1]!.toLowerCase()
		cleaned = `${juiceZestMatch[2]} ${juiceZestMatch[3]}, ${descriptor}`
	}

	// "X to Y" range normalization: "2 to 3 tablespoons" → "2-3 tablespoons"
	cleaned = cleaned.replace(
		/^(~?[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]+)\s+to\s+([\d.\/½⅓⅔¼¾⅛⅜⅝⅞]+)\s/,
		'$1-$2 ',
	)

	// Normalize ranges with spaces around dash: "1½ -2 cups" → "1½-2 cups"
	cleaned = cleaned.replace(
		/^(~?[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]+)\s*[-–]\s*([\d.\/½⅓⅔¼¾⅛⅜⅝⅞]+)\s/,
		'$1-$2 ',
	)

	// Handle "X to taste" pattern (without comma).
	// Only match when not starting with a digit (avoids capturing "2 tsp salt to taste"
	// which should fall through to the main regex for proper amount/unit parsing).
	const toTasteMatch = cleaned.match(/^([a-zA-Z][^,]*?)\s+to\s+taste$/i)
	if (toTasteMatch) {
		return { name: toTasteMatch[1]!.trim(), notes: 'to taste' }
	}

	// Handle mixed unicode fractions with space: "1 ½ cups flour" → combine to "1½ cups flour"
	// Must come before the main regex which would split "1" and "½" incorrectly
	cleaned = cleaned.replace(/^(\d+)\s+([½⅓⅔¼¾⅛⅜⅝⅞])/, '$1$2')

	// Handle mixed ASCII fractions: "1 3/4 cups flour", "1 1/2 eggs"
	// The main regex can't capture "1 3/4" as one token due to the internal space
	const mixedFractionMatch = cleaned.match(
		/^(~?\d+)\s+(\d+\/\d+)\s+(.+)$/,
	)
	if (mixedFractionMatch) {
		const [, whole, frac, rest] = mixedFractionMatch
		const amount = `${whole} ${frac}`
		const words = rest!.trim().split(/\s+/)
		let unit: string | undefined
		let name: string
		// Check for "fl oz" two-word unit before single-word unit check
		if (
			words.length > 2 &&
			words[0] &&
			/^fl\.?$/i.test(words[0]) &&
			words[1] &&
			/^oz\.?$/i.test(words[1])
		) {
			unit = 'fl oz'
			name = words.slice(2).join(' ')
		} else if (words.length > 1 && words[0] && isUnit(words[0])) {
			unit = stripUnitPeriod(words[0])
			name = words.slice(1).join(' ')
		} else {
			name = words.join(' ')
		}
		let notes: string | undefined
		if (name.includes(',')) {
			const split = splitNameNotes(name)
			name = split.name
			notes = split.notes
		}
		const toTasteSuffix = name.match(/^(.+?)\s+to\s+taste$/i)
		if (toTasteSuffix) {
			name = toTasteSuffix[1]!
			notes = notes ? notes + ', to taste' : 'to taste'
		}
		;({ name, notes } = extractTrailingParenthetical(name, notes))
		return { name, amount, unit, notes }
	}

	// Handle "fl oz" multi-word unit: "2 fl oz lime juice"
	const flOzMatch = cleaned.match(
		/^(~?[\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞]+)\s*(?:fl\.?\s*oz\.?|fluid\s+ounces?)\s+(.+)$/i,
	)
	if (flOzMatch) {
		let name = flOzMatch[2]!.trim()
		let notes: string | undefined
		if (name.includes(',')) {
			const split = splitNameNotes(name)
			name = split.name
			notes = split.notes
		}
		const toTasteSuffix = name.match(/^(.+?)\s+to\s+taste$/i)
		if (toTasteSuffix) {
			name = toTasteSuffix[1]!
			notes = notes ? notes + ', to taste' : 'to taste'
		}
		;({ name, notes } = extractTrailingParenthetical(name, notes))
		return { name, amount: flOzMatch[1], unit: 'fl oz', notes }
	}

	// Handle "N (X unit) container name" → e.g. "1 (14.5 oz) can diced tomatoes"
	const nestedMatch = cleaned.match(
		/^([\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞~]+)\s*\(([^)]+)\)\s*([a-zA-Z]+\.?)\s+(.+)$/,
	)
	if (nestedMatch) {
		const [, nestedAmount, parenthetical, possibleUnit, rest] = nestedMatch
		if (possibleUnit && isUnit(possibleUnit)) {
			let name = rest!.trim()
			let notes: string | undefined = parenthetical!.trim()
			if (name.includes(',')) {
				const split = splitNameNotes(name)
				name = split.name
				if (split.notes) {
					notes = notes + '; ' + split.notes
				}
			}
			;({ name, notes } = extractTrailingParenthetical(name, notes))
			return {
				name,
				amount: nestedAmount,
				unit: stripUnitPeriod(possibleUnit),
				notes,
			}
		}
	}

	// Try to match: amount + optional unit + name
	// Handle both "600 g broccoli" and "600g broccoli"
	// Unicode fractions (½⅓⅔¼¾⅛⅜⅝⅞) included in amount character class
	// Trailing period on unit allowed for abbreviations like "tbsp."
	const match = cleaned.match(
		/^(~?[\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞]+)\s*([a-zA-Z]+\.?)?\s+(.+)$/,
	)

	if (match) {
		const amount = match[1]
		const possibleUnit = match[2]
		let remainder = match[3]?.trim() || ''
		let unit: string | undefined = undefined
		let name = ''
		let notes: string | undefined = undefined

		// Check if the matched word is a valid unit
		if (possibleUnit && isUnit(possibleUnit)) {
			unit = stripUnitPeriod(possibleUnit)
			name = remainder
		} else if (possibleUnit) {
			// If it's not a valid unit, it's part of the ingredient name
			name = possibleUnit + ' ' + remainder
		} else {
			// Check if the first word of remainder is a valid unit
			const words = remainder.split(/\s+/)
			if (words.length > 1 && words[0] && isUnit(words[0])) {
				unit = stripUnitPeriod(words[0])
				name = words.slice(1).join(' ')
			} else {
				name = remainder
			}
		}

		// Extract leading parenthetical: "(about 8 oz) shredded cheddar" → notes + name
		const leadingParen = name.match(/^\(([^)]+)\)\s+(.+)$/)
		if (leadingParen) {
			notes = leadingParen[1]!.trim()
			name = leadingParen[2]!
		}

		// Extract embedded parenthetical: "whole (8 oz each) boneless" → notes + cleaned name
		// Only matches when there's content after the closing paren (not trailing parens)
		if (!leadingParen) {
			const embeddedParen = name.match(
				/^([^(]+?)\s*\(([^)]+)\)\s+(.+)$/,
			)
			if (embeddedParen) {
				notes = notes
					? notes + ', ' + embeddedParen[2]!.trim()
					: embeddedParen[2]!.trim()
				name =
					embeddedParen[1]!.trim() +
					' ' +
					embeddedParen[3]!.trim()
			}
		}

		// Split name on comma to extract notes
		if (name && name.includes(',')) {
			const split = splitNameNotes(name)
			name = split.name
			if (split.notes) {
				notes = notes ? notes + ', ' + split.notes : split.notes
			}
		}

		// Extract trailing "to taste" from name to notes
		const toTasteSuffix = name.match(/^(.+?)\s+to\s+taste$/i)
		if (toTasteSuffix) {
			name = toTasteSuffix[1]!
			notes = notes ? notes + ', to taste' : 'to taste'
		}

		;({ name, notes } = extractTrailingParenthetical(name, notes))

		return { name: name?.trim() || '', amount, unit, notes }
	}

	// For ingredients without amounts, also check for comma-separated notes
	let name = cleaned
	let notes: string | undefined = undefined

	if (cleaned.includes(',')) {
		const split = splitNameNotes(cleaned)
		name = split.name
		notes = split.notes
	}

	;({ name, notes } = extractTrailingParenthetical(name, notes))

	return { name, notes }
}
