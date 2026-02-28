export type ParsedItem = {
	name: string
	quantity: string
	unit: string
}

const UNITS = [
	'pounds?',
	'lbs?',
	'ounces?',
	'oz',
	'cups?',
	'gallons?',
	'liters?',
	'litres?',
	'kilograms?',
	'kg',
	'grams?',
	'g',
	'bunch(?:es)?',
	'bags?',
	'box(?:es)?',
	'cans?',
	'bottles?',
	'packs?',
	'dozens?',
	'each',
	'tablespoons?',
	'tbsp',
	'teaspoons?',
	'tsp',
	'ml',
	'pieces?',
	'slices?',
	'loaf|loaves',
	'heads?',
	'cloves?',
	'stalks?',
	'sprigs?',
	'jars?',
	'cartons?',
	'containers?',
	'sticks?',
]

const UNIT_PATTERN = UNITS.join('|')

const WORD_NUMBERS: Record<string, string> = {
	a: '1',
	an: '1',
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
	twenty: '20',
	half: '0.5',
}

// Compound word numbers Whisper might produce
const COMPOUND_NUMBERS: [RegExp, string][] = [
	[/^a\s+hundred\b/i, '100'],
	[/^a\s+dozen\b/i, '12'],
	[/^half\s+a\s+dozen\b/i, '6'],
]

const UNIT_ALIASES: Record<string, string> = {
	pound: 'lb',
	pounds: 'lbs',
	lb: 'lb',
	lbs: 'lbs',
	ounce: 'oz',
	ounces: 'oz',
	kilogram: 'kg',
	kilograms: 'kg',
	gram: 'g',
	grams: 'g',
	liter: 'L',
	liters: 'L',
	litre: 'L',
	litres: 'L',
	tablespoon: 'tbsp',
	tablespoons: 'tbsp',
	teaspoon: 'tsp',
	teaspoons: 'tsp',
}

function normalizeUnit(unit: string): string {
	return UNIT_ALIASES[unit.toLowerCase()] ?? unit
}

/**
 * Clean up raw Whisper transcript text:
 * - Strip trailing punctuation
 * - Strip leading filler words ("um", "uh", "like", etc.)
 * - Normalize compound word-numbers ("a hundred" → "100", "half a dozen" → "6")
 * - Normalize single word-numbers ("one" → "1", "two" → "2")
 * - Strip dangling article after number ("0.5 a pound" → "0.5 pound")
 */
function normalizeTranscript(raw: string): string {
	// Strip trailing punctuation and whitespace
	let text = raw.trim().replace(/[.,!?;:]+$/, '').trim()

	// Strip leading filler words
	text = text.replace(/^(?:um|uh|uh+m*|hmm?|oh|like|so|well|okay|ok)\s+/i, '')

	// Compound word-numbers first (must come before single word-number check)
	for (const [pattern, replacement] of COMPOUND_NUMBERS) {
		if (pattern.test(text)) {
			text = text.replace(pattern, replacement)
			break
		}
	}

	// Single leading word-number → digit
	const wordMatch = text.match(/^(\S+)\s+(.+)$/)
	if (wordMatch) {
		const replacement = WORD_NUMBERS[wordMatch[1]!.toLowerCase()]
		if (replacement) {
			text = `${replacement} ${wordMatch[2]}`
		}
	}

	// Strip dangling article between number and unit: "0.5 a pound" → "0.5 pound"
	text = text.replace(
		/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s+(?:a|an)\s+/i,
		'$1 ',
	)

	return text
}

// Match: "<number> <unit> [of] <name>" or "<number> <name>"
const QTY_UNIT_NAME = new RegExp(
	`^(\\d+(?:\\.\\d+)?(?:\\s*/\\s*\\d+)?)\\s+(${UNIT_PATTERN})\\s+(?:of\\s+)?(.+)$`,
	'i',
)
const QTY_NAME = /^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s+(.+)$/

export function parseSpeechItem(transcript: string): ParsedItem {
	const text = normalizeTranscript(transcript)

	if (!text) {
		return { name: '', quantity: '', unit: '' }
	}

	// Try "2 pounds of chicken thighs" or "2 lbs chicken"
	const qtyUnitMatch = text.match(QTY_UNIT_NAME)
	if (qtyUnitMatch) {
		return {
			quantity: qtyUnitMatch[1]!,
			unit: normalizeUnit(qtyUnitMatch[2]!),
			name: qtyUnitMatch[3]!.trim().toLowerCase(),
		}
	}

	// Try "3 eggs"
	const qtyMatch = text.match(QTY_NAME)
	if (qtyMatch) {
		return {
			quantity: qtyMatch[1]!,
			unit: '',
			name: qtyMatch[2]!.trim().toLowerCase(),
		}
	}

	// Just a name: "milk"
	return { name: text.toLowerCase(), quantity: '', unit: '' }
}

/**
 * Split a transcript that may contain multiple items separated by
 * commas or "and", then parse each individually.
 *
 * "two pounds of chicken, a dozen eggs, apples and parsley"
 * → [{ name: "chicken", qty: "2", unit: "lbs" }, { name: "eggs", qty: "12", unit: "" }, ...]
 */
export function parseSpeechItems(transcript: string): ParsedItem[] {
	const cleaned = transcript.trim().replace(/[.!?;:]+$/, '').trim()
	if (!cleaned) return []

	// Split on comma or " and " (but not "and" inside a word like "mandarin")
	const segments = cleaned
		.split(/,|\band\b/i)
		.map((s) => s.trim())
		.filter(Boolean)

	const items = segments
		.map((s) => parseSpeechItem(s))
		.filter((item) => item.name.length > 0)

	return items
}
