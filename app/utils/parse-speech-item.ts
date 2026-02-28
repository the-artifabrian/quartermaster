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
	'packages?',
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
	'cases?',
	'pints?',
	'quarts?',
	'tins?',
	'tubes?',
	'rolls?',
	'tubs?',
	'bars?',
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
	thirteen: '13',
	fourteen: '14',
	fifteen: '15',
	sixteen: '16',
	seventeen: '17',
	eighteen: '18',
	nineteen: '19',
	twenty: '20',
	half: '0.5',
}

// Compound word numbers Whisper might produce
const COMPOUND_NUMBERS: [RegExp, string][] = [
	[/^half\s+a\s+dozen\b/i, '6'],
	[/^a\s+hundred\b/i, '100'],
	[/^a\s+dozen\b/i, '12'],
	[/^a\s+couple\s+(?:of\s+)?/i, '2 '],
]

// "<word-number> hundred" → multiply (e.g. "three hundred" → "300")
const WORD_HUNDRED_PATTERN = /^(\S+)\s+hundred\b/i

const UNIT_ALIASES: Record<string, string> = {
	pound: 'lb',
	pounds: 'lb',
	lb: 'lb',
	lbs: 'lb',
	ounce: 'oz',
	ounces: 'oz',
	kilogram: 'kg',
	kilograms: 'kg',
	gram: 'g',
	grams: 'g',
	liter: 'l',
	liters: 'l',
	litre: 'l',
	litres: 'l',
	cup: 'cup',
	cups: 'cup',
	tablespoon: 'tbsp',
	tablespoons: 'tbsp',
	teaspoon: 'tsp',
	teaspoons: 'tsp',
	pint: 'pint',
	pints: 'pint',
	quart: 'quart',
	quarts: 'quart',
	gallon: 'gallon',
	gallons: 'gallon',
}

function normalizeUnit(unit: string): string {
	return UNIT_ALIASES[unit.toLowerCase()] ?? unit
}

const FILLER_PATTERN =
	/^(?:um|uh|uh+m*|hmm?|oh|like|so|well|okay|ok|yeah|yep|yup|right|actually|and|also)\s+/i

// Instructional prefixes people use when dictating to an app
const PREFIX_PATTERN =
	/^(?:I\s+need|we\s+need|I\s+want|we\s+want|get\s+me|get|add|buy|grab)\s+/i

const VAGUE_QUANTIFIER_PATTERN =
	/^(?:some|a\s+few|a\s+lot\s+of|a\s+bit\s+of)\s+/i

/**
 * Clean up raw Whisper transcript text:
 * - Strip trailing punctuation and internal commas (Whisper noise)
 * - Strip leading filler words ("um", "uh", "like", "yeah", etc.) — repeatable
 * - Strip instructional prefixes ("I need", "we need", "get", "add", etc.)
 * - Strip vague quantifiers ("some", "a few", "a lot of", "a bit of")
 * - Normalize compound word-numbers ("a hundred" → "100", "half a dozen" → "6")
 * - Normalize "<word> hundred" compounds ("three hundred" → "300")
 * - Normalize single word-numbers ("one" → "1", "two" → "2")
 * - Normalize mixed numbers ("1 1/2" → "1 1/2" kept together)
 * - Strip dangling article after number ("0.5 a pound" → "0.5 pound")
 */
function normalizeTranscript(raw: string): string {
	// Strip trailing punctuation and whitespace
	let text = raw.trim().replace(/[.,!?;:]+$/, '').trim()

	// Strip commas — Whisper inserts them between filler words and clauses
	// (e.g. "Um, like, some Cheerios"). By the time text reaches here, commas
	// from multi-item splitting have already been consumed by parseSpeechItems.
	text = text.replace(/,/g, ' ').replace(/\s{2,}/g, ' ').trim()

	// Strip filler words, instructional prefixes, and vague quantifiers in a
	// loop — they can appear in any combination ("oh I need like some milk")
	let prev
	do {
		prev = text
		text = text.replace(FILLER_PATTERN, '')
		text = text.replace(PREFIX_PATTERN, '')
		text = text.replace(VAGUE_QUANTIFIER_PATTERN, '')
	} while (text !== prev)

	// Compound word-numbers first (must come before single word-number check)
	for (const [pattern, replacement] of COMPOUND_NUMBERS) {
		if (pattern.test(text)) {
			text = text.replace(pattern, replacement).trim()
			break
		}
	}

	// "<word-number> hundred" → multiply ("three hundred" → "300")
	const hundredMatch = text.match(WORD_HUNDRED_PATTERN)
	if (hundredMatch) {
		const multiplier = WORD_NUMBERS[hundredMatch[1]!.toLowerCase()]
		if (multiplier) {
			const value = Number(multiplier) * 100
			text = text.replace(WORD_HUNDRED_PATTERN, String(value))
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

// Quantity pattern: integer, decimal, fraction, or mixed number (1 1/2)
const QTY = `(\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\s*\\/\\s*\\d+)`

// Match: "<number> <unit> [of] <name>" or "<number> <name>"
const QTY_UNIT_NAME = new RegExp(
	`^${QTY}\\s+(${UNIT_PATTERN})\\s+(?:of\\s+)?(.+)$`,
	'i',
)
const QTY_NAME = new RegExp(`^${QTY}\\s+(.+)$`)

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

// Compound grocery names containing "and" that should not be split
const COMPOUND_NAMES = [
	'mac and cheese',
	'macaroni and cheese',
	'salt and pepper',
	'oil and vinegar',
	'bread and butter',
	'rice and beans',
	'chips and salsa',
	'franks and beans',
]

const COMPOUND_PLACEHOLDER = '\x00COMPOUND'

/**
 * Split a transcript that may contain multiple items separated by
 * commas or "and", then parse each individually.
 *
 * Protects known compound grocery names ("mac and cheese") from being split.
 *
 * "two pounds of chicken, a dozen eggs, apples and parsley"
 * → [{ name: "chicken", qty: "2", unit: "lb" }, { name: "eggs", qty: "12", unit: "" }, ...]
 */
export function parseSpeechItems(transcript: string): ParsedItem[] {
	let cleaned = transcript.trim().replace(/[.!?;:]+$/, '').trim()
	if (!cleaned) return []

	// Protect compound names from being split on "and"
	const restorations: string[] = []
	for (const compound of COMPOUND_NAMES) {
		const idx = cleaned.toLowerCase().indexOf(compound)
		if (idx !== -1) {
			const placeholder = `${COMPOUND_PLACEHOLDER}${restorations.length}`
			restorations.push(cleaned.slice(idx, idx + compound.length))
			cleaned =
				cleaned.slice(0, idx) + placeholder + cleaned.slice(idx + compound.length)
		}
	}

	// Split on comma or " and " (but not "and" inside a word like "mandarin")
	const segments = cleaned
		.split(/,|\band\b/i)
		.map((s) => s.trim())
		.filter(Boolean)

	// Restore compound names
	const restored = segments.map((s) =>
		s.replace(/\x00COMPOUND(\d+)/g, (_, i) => restorations[Number(i)]!),
	)

	const items = restored
		.map((s) => parseSpeechItem(s))
		.filter((item) => item.name.length > 0)

	return items
}
