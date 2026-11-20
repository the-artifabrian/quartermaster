import {
	MAX_INGREDIENT_AMOUNT_LENGTH,
	MAX_INGREDIENT_NAME_LENGTH,
	MAX_INGREDIENT_NOTES_LENGTH,
	MAX_INGREDIENT_UNIT_LENGTH,
} from './recipe-validation.ts'

/**
 * The longest ingredient line the parser reads; the rest is dropped before
 * parsing. Well over what the four fields can hold together, so a line that
 * is too long still overflows them and import reports it as shortened.
 */
export const MAX_INGREDIENT_LINE_LENGTH =
	MAX_INGREDIENT_NAME_LENGTH +
	MAX_INGREDIENT_AMOUNT_LENGTH +
	MAX_INGREDIENT_UNIT_LENGTH +
	MAX_INGREDIENT_NOTES_LENGTH +
	200

// The patterns below read whole ingredient lines, so none may let two
// quantifiers take turns over the same characters: a long run of spaces,
// brackets or digits would then backtrack quadratically or worse. A name or
// notes part is matched as `\s+(\S.*|[^\S\n\r\u2028\u2029])$` rather than
// `\s+(.+)$` for that reason. It starts at its first non-space, or is the
// last space when only spaces are left, which is what `(.+)` held too.

/**
 * Apple Notes links "++[text](url)++" keep their text. Neither part may
 * hold a bracket, so an opener that never closes ends its scan at the next
 * one instead of at the end of the line.
 */
export const APPLE_NOTES_LINK = /\+\+\[([^[\]]+)\]\([^)[\]]+\)\+\+/g
const MARKDOWN_LINK = /\[([^[\]]+)\]\([^)[\]]+\)/g

const LINE_BREAK = /[\n\r\u2028\u2029]/

/**
 * A global replace of a pattern that ends in `closer`, run only up to the
 * last `closer`. No match can end later, and leaving out the tail means an
 * opener with no closer after it never scans to the end of the text, so a
 * run of unclosed openers stays linear.
 */
function replaceUpToLast(
	text: string,
	closer: string,
	pattern: RegExp,
	replacement: string,
): string {
	const end = text.lastIndexOf(closer) + closer.length
	if (end < closer.length) return text
	return text.slice(0, end).replace(pattern, replacement) + text.slice(end)
}

/**
 * "((text))" → "(text)", as /\(\(([^)]+)\)\)/g would, in one pass: each
 * "((" pairs with the first ")" after it, which matches only when another ")"
 * follows at once.
 */
function stripDoubleParens(text: string): string {
	let out = ''
	let from = 0
	let close = -1
	let open = text.indexOf('((')
	while (open !== -1) {
		if (close < open + 2) close = text.indexOf(')', open + 2)
		if (close === -1) break
		if (close > open + 2 && text[close + 1] === ')') {
			out += `${text.slice(from, open)}(${text.slice(open + 2, close)})`
			from = close + 2
			open = text.indexOf('((', from)
		} else {
			open = text.indexOf('((', open + 1)
		}
	}
	return out + text.slice(from)
}

const TO_TASTE_SUFFIX = /(?<!\s)\s+to\s+taste$/i
// A quick look at the end before TO_TASTE_SUFFIX reads the whole text.
const endsWithTaste = (text: string) => text.slice(-5).toLowerCase() === 'taste'

/**
 * What comes before a closing "to taste", or null when there is none. Like
 * /^(.+?)\s+to\s+taste$/i: the part before is at least one character on one
 * line.
 */
function beforeToTaste(text: string): string | null {
	if (!endsWithTaste(text)) return null
	const match = TO_TASTE_SUFFIX.exec(text)
	if (!match || match.index === 0) return null
	const before = text.slice(0, match.index)
	return LINE_BREAK.test(before) ? null : before
}

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
	if (!text.includes('(') && !text.includes(')')) return text
	// Pass 1: left-to-right, remove orphaned )
	let depth = 0
	const kept: string[] = []
	for (const ch of text) {
		if (ch === ')') {
			if (depth === 0) continue // orphaned ), skip
			depth--
		} else if (ch === '(') {
			depth++
		}
		kept.push(ch)
	}
	if (depth === 0) return kept.join('')
	// Pass 2: right-to-left, remove as many ( as are left open
	for (let i = kept.length - 1; i >= 0 && depth > 0; i--) {
		if (kept[i] === '(') {
			kept[i] = ''
			depth--
		}
	}
	return kept
		.join('')
		.replace(/\s{2,}/g, ' ')
		.trim()
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
		splitIndex < parts.length ? parts.slice(splitIndex).join(', ') : undefined
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
	const paren = trailingParenthetical(name)
	if (paren) {
		const extracted = paren.inside.trim()
		return {
			name: paren.before.trim(),
			notes: existingNotes ? existingNotes + ', ' + extracted : extracted,
		}
	}
	return { name, notes: existingNotes }
}

/**
 * Splits "name (inside)" at a closing parenthetical, as
 * /^(.+?)\s*\(([^)]+)\)\s*$/ would, without backtracking. The parenthetical
 * opens at the first "(" after any earlier ")", and holds no ")" itself.
 * The part before is at least one character on one line.
 */
function trailingParenthetical(
	name: string,
): { before: string; inside: string } | null {
	const text = name.trimEnd()
	const close = text.length - 1
	if (text[close] !== ')') return null
	const afterEarlierClose = text.lastIndexOf(')', close - 1) + 1
	const open = text.indexOf('(', Math.max(afterEarlierClose, 1))
	if (open === -1 || open >= close - 1) return null
	let beforeEnd = open
	while (beforeEnd > 1 && /\s/.test(text[beforeEnd - 1]!)) beforeEnd--
	const before = text.slice(0, beforeEnd)
	if (LINE_BREAK.test(before)) return null
	return { before, inside: text.slice(open + 1, close) }
}

/**
 * True when an ingredient list is written in all-caps house style (older
 * sites, OCR'd text, shouty emails). When the whole list shouts, caps carry
 * no heading signal and the all-caps heuristic must be disabled — otherwise
 * "SALT" and "OLIVE OIL" import as section headings instead of ingredients.
 */
export function isAllCapsHouseStyle(lines: string[]): boolean {
	const lettered = lines.filter((line) => /[a-zA-Z]/.test(line))
	if (lettered.length < 3) return false
	const caps = lettered.filter((line) => !/[a-z]/.test(line))
	return caps.length > lettered.length / 2
}

/**
 * Detect lines in an ingredient list that are sub-section headings rather
 * than ingredients: "For the crust", "Topping:", "PIE DOUGH". Returns the
 * cleaned heading name (leading "For the" dropped, trailing colon stripped),
 * or null when the line reads like a real ingredient. Anything containing a
 * digit or fraction is assumed to carry an amount and is never a heading.
 *
 * Pass `allCapsIsHeading: false` (see isAllCapsHouseStyle) to disable the
 * all-caps heuristic; the explicit "For the …" and trailing-colon signals
 * still apply.
 */
export function detectIngredientHeading(
	line: string,
	opts?: { allCapsIsHeading?: boolean },
): string | null {
	const trimmed = line.trim()
	if (!trimmed || trimmed.length > 60) return null
	if (/[\d½⅓⅔¼¾⅛⅜⅝⅞]/.test(trimmed)) return null
	if (trimmed.includes(',')) return null

	// "For the crust" / "For frying:" → "Crust" / "Frying"
	const forMatch = trimmed.match(/^for\s+(?:the\s+)?([^:]+?):?$/i)
	if (forMatch) {
		const name = forMatch[1]!.trim()
		if (name) return name[0]!.toUpperCase() + name.slice(1)
	}

	// "Topping:" — trailing colon with no amount
	if (/^[^:]{2,}:$/.test(trimmed)) {
		return trimmed.slice(0, -1).trim()
	}

	// "PIE DOUGH" — short all-caps line. Needs ≥3 letters (stray "XL"
	// shouldn't trigger) and ≤3 words (an all-caps site writing
	// "SALT AND PEPPER TO TASTE" is still an ingredient).
	if (
		(opts?.allCapsIsHeading ?? true) &&
		trimmed.length <= 40 &&
		/^[A-Z][A-Z\s&'-]*$/.test(trimmed) &&
		trimmed.replace(/[^A-Z]/g, '').length >= 3 &&
		trimmed.split(/\s+/).length <= 3
	) {
		return trimmed
	}

	return null
}

/** The first MAX_INGREDIENT_LINE_LENGTH characters, never half an emoji. */
function capLine(line: string): string {
	if (line.length <= MAX_INGREDIENT_LINE_LENGTH) return line
	const head = line.slice(0, MAX_INGREDIENT_LINE_LENGTH)
	return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head
}

// Parse an ingredient string into structured parts
export function parseIngredient(line: string): {
	name: string
	amount?: string
	unit?: string
	notes?: string
	isHeading?: boolean
} | null {
	let cleaned = capLine(line)
		.replace(/^-\s*\[[ x]\]\s*/, '')
		.replace(APPLE_NOTES_LINK, '$1')
		.replace(MARKDOWN_LINK, '$1')
		.trim()
	if (!cleaned) return null

	// Strip redundant parens after commas: "beans, (trimmed)" → "beans, trimmed"
	// Common in JSON-LD recipeIngredient data from recipe sites
	cleaned = replaceUpToLast(cleaned, ')', /,\s*\(([^)]+)\)/g, ', $1')

	// Fix broken parenthetical fragments from poorly-formatted JSON-LD:
	// "chicken cutlets, sliced thin), (approx." → "chicken cutlets, sliced thin, approx."
	cleaned = cleaned.replace(/\)\s*,\s*\(/g, ', ')

	// Strip double parentheses: "((I like to use panko))" → "(I like to use panko)"
	cleaned = stripDoubleParens(cleaned)

	// Strip orphaned parentheses from broken HTML/JSON-LD
	cleaned = stripOrphanedParens(cleaned)

	// Strip "about"/"approximately" prefix: "about 2 cups flour" → "2 cups flour"
	cleaned = cleaned.replace(/^(?:about|approximately)\s+/i, '')

	// Strip parenthetical approximation markers: "(approx.)" / "(approximately)"
	if (/\(approx/i.test(cleaned)) {
		cleaned = cleaned.replace(/(?<!\s)\s*\(approx\.?\)/gi, '')
		cleaned = cleaned.replace(/(?<!\s)\s*\(approximately\)/gi, '')
	}

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
		/^(juice|zest|juice\s+and\s+zest)\s+of\s+([\d½⅓⅔¼¾⅛⅜⅝⅞\/]+)\s+(\S.*|[^\S\n\r\u2028\u2029])$/i,
	)
	if (juiceZestMatch) {
		const descriptor = juiceZestMatch[1]!.toLowerCase()
		cleaned = `${juiceZestMatch[2]} ${juiceZestMatch[3]}, ${descriptor}`
	}

	// Amount patterns take a comma only between digits ("1,5", "1,000"), so a
	// number isn't split at its comma and "2, chopped" still starts notes.
	// parseAmount decides what the amount means.

	// "X to Y" range normalization: "2 to 3 tablespoons" → "2-3 tablespoons"
	cleaned = cleaned.replace(
		/^(~?(?:[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+)\s+to\s+((?:[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+)\s/,
		'$1-$2 ',
	)

	// Normalize ranges with spaces around dash: "1½ -2 cups" → "1½-2 cups"
	cleaned = cleaned.replace(
		/^(~?(?:[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+)\s*[-–]\s*((?:[\d.\/½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+)\s/,
		'$1-$2 ',
	)

	// Handle "X to taste" pattern (without comma).
	// Only match when not starting with a digit (avoids capturing "2 tsp salt to taste"
	// which should fall through to the main regex for proper amount/unit parsing).
	const toTasteMatch = endsWithTaste(cleaned)
		? TO_TASTE_SUFFIX.exec(cleaned)
		: null
	const beforeTaste = toTasteMatch ? cleaned.slice(0, toTasteMatch.index) : ''
	if (/^[a-zA-Z][^,]*$/.test(beforeTaste)) {
		return { name: beforeTaste.trim(), notes: 'to taste' }
	}

	// Handle mixed unicode fractions with space: "1 ½ cups flour" → combine to "1½ cups flour"
	// Must come before the main regex which would split "1" and "½" incorrectly
	cleaned = cleaned.replace(/^(\d+)\s+([½⅓⅔¼¾⅛⅜⅝⅞])/, '$1$2')

	// Handle mixed ASCII fractions: "1 3/4 cups flour", "1 1/2 eggs"
	// The main regex can't capture "1 3/4" as one token due to the internal space
	const mixedFractionMatch = cleaned.match(
		/^(~?\d+)\s+(\d+\/\d+)\s+(\S.*|[^\S\n\r\u2028\u2029])$/,
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
		const toTasteSuffix = beforeToTaste(name)
		if (toTasteSuffix !== null) {
			name = toTasteSuffix
			notes = notes ? notes + ', to taste' : 'to taste'
		}
		;({ name, notes } = extractTrailingParenthetical(name, notes))
		return { name, amount, unit, notes }
	}

	// Handle "fl oz" multi-word unit: "2 fl oz lime juice"
	const flOzMatch = cleaned.match(
		/^(~?(?:[\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+)\s*(?:fl\.?\s*oz\.?|fluid\s+ounces?)\s+(\S.*|[^\S\n\r\u2028\u2029])$/i,
	)
	if (flOzMatch) {
		let name = flOzMatch[2]!.trim()
		let notes: string | undefined
		if (name.includes(',')) {
			const split = splitNameNotes(name)
			name = split.name
			notes = split.notes
		}
		const toTasteSuffix = beforeToTaste(name)
		if (toTasteSuffix !== null) {
			name = toTasteSuffix
			notes = notes ? notes + ', to taste' : 'to taste'
		}
		;({ name, notes } = extractTrailingParenthetical(name, notes))
		return { name, amount: flOzMatch[1], unit: 'fl oz', notes }
	}

	// Handle "N (X unit) container name" → e.g. "1 (14.5 oz) can diced tomatoes"
	const nestedMatch = cleaned.match(
		/^((?:[\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞~]|,(?=\d))+)\s*\(([^)]+)\)\s*([a-zA-Z]+\.?)\s+(\S.*|[^\S\n\r\u2028\u2029])$/,
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
	// A count times a size ("2 x 400 g", "2x400g") stays one amount; there is
	// no pack size, so parseAmount leaves it as written and out of totals.
	const match = cleaned.match(
		/^(~?(?:[\d.\/\-–½⅓⅔¼¾⅛⅜⅝⅞]|,(?=\d))+(?:\s*[x×]\s*\d(?:[\d.\/]|,(?=\d))*)?)(?:\s*([a-zA-Z]+\.?))?\s+(\S.*|[^\S\n\r\u2028\u2029])$/,
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
		const leadingParen = name.match(
			/^\(([^)]+)\)\s+(\S.*|[^\S\n\r\u2028\u2029])$/,
		)
		if (leadingParen) {
			notes = leadingParen[1]!.trim()
			name = leadingParen[2]!
		}

		// Extract embedded parenthetical: "whole (8 oz each) boneless" → notes + cleaned name
		// Only matches when there's content after the closing paren (not trailing parens)
		if (!leadingParen) {
			const embeddedParen = name.match(
				/^([^(]+)\(([^)]+)\)\s+(\S.*|[^\S\n\r\u2028\u2029])$/,
			)
			if (embeddedParen) {
				notes = notes
					? notes + ', ' + embeddedParen[2]!.trim()
					: embeddedParen[2]!.trim()
				name = embeddedParen[1]!.trim() + ' ' + embeddedParen[3]!.trim()
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
		const toTasteSuffix = beforeToTaste(name)
		if (toTasteSuffix !== null) {
			name = toTasteSuffix
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
