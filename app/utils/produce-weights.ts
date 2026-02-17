/**
 * Lookup table of common produce items with average weights in grams.
 * Used to convert weight-based shopping list quantities into approximate counts
 * (e.g., "300g carrots" → "~2 carrots (300 g)").
 */

type ProduceEntry = {
	/** Average weight of one item in grams */
	weightGrams: number
	/** Singular display name */
	singular: string
	/** Plural display name */
	plural: string
}

const PRODUCE_WEIGHTS: Record<string, ProduceEntry> = {
	apple: { weightGrams: 180, singular: 'apple', plural: 'apples' },
	avocado: { weightGrams: 170, singular: 'avocado', plural: 'avocados' },
	banana: { weightGrams: 120, singular: 'banana', plural: 'bananas' },
	'bell pepper': {
		weightGrams: 150,
		singular: 'bell pepper',
		plural: 'bell peppers',
	},
	carrot: { weightGrams: 150, singular: 'carrot', plural: 'carrots' },
	celery: { weightGrams: 40, singular: 'stalk', plural: 'stalks' },
	cucumber: { weightGrams: 300, singular: 'cucumber', plural: 'cucumbers' },
	eggplant: { weightGrams: 450, singular: 'eggplant', plural: 'eggplants' },
	garlic: { weightGrams: 5, singular: 'clove', plural: 'cloves' },
	ginger: { weightGrams: 25, singular: 'piece', plural: 'pieces' },
	lemon: { weightGrams: 60, singular: 'lemon', plural: 'lemons' },
	lime: { weightGrams: 50, singular: 'lime', plural: 'limes' },
	mango: { weightGrams: 300, singular: 'mango', plural: 'mangoes' },
	onion: { weightGrams: 170, singular: 'onion', plural: 'onions' },
	orange: { weightGrams: 180, singular: 'orange', plural: 'oranges' },
	peach: { weightGrams: 150, singular: 'peach', plural: 'peaches' },
	pear: { weightGrams: 180, singular: 'pear', plural: 'pears' },
	potato: { weightGrams: 170, singular: 'potato', plural: 'potatoes' },
	'sweet potato': {
		weightGrams: 200,
		singular: 'sweet potato',
		plural: 'sweet potatoes',
	},
	tomato: { weightGrams: 150, singular: 'tomato', plural: 'tomatoes' },
	'cherry tomato': {
		weightGrams: 10,
		singular: 'cherry tomato',
		plural: 'cherry tomatoes',
	},
	'plum tomato': {
		weightGrams: 60,
		singular: 'plum tomato',
		plural: 'plum tomatoes',
	},
	zucchini: { weightGrams: 200, singular: 'zucchini', plural: 'zucchini' },
	beetroot: { weightGrams: 150, singular: 'beetroot', plural: 'beetroots' },
	turnip: { weightGrams: 200, singular: 'turnip', plural: 'turnips' },
	parsnip: { weightGrams: 150, singular: 'parsnip', plural: 'parsnips' },
	shallot: { weightGrams: 40, singular: 'shallot', plural: 'shallots' },
}

/** Aliases that map variant names to canonical PRODUCE_WEIGHTS keys */
const ALIASES: Record<string, string> = {
	'red bell pepper': 'bell pepper',
	'green bell pepper': 'bell pepper',
	'yellow bell pepper': 'bell pepper',
	'orange bell pepper': 'bell pepper',
	capsicum: 'bell pepper',
	'red onion': 'onion',
	'yellow onion': 'onion',
	'white onion': 'onion',
	'brown onion': 'onion',
	'red potato': 'potato',
	'yukon gold potato': 'potato',
	'russet potato': 'potato',
	'roma tomato': 'plum tomato',
	aubergine: 'eggplant',
	courgette: 'zucchini',
	beet: 'beetroot',
	kumara: 'sweet potato',
}

const WEIGHT_UNITS = new Set([
	'g',
	'gram',
	'grams',
	'kg',
	'kilogram',
	'kilograms',
	'oz',
	'ounce',
	'ounces',
	'lb',
	'lbs',
	'pound',
	'pounds',
])

/** Returns true if the unit represents weight (g, kg, oz, lb) */
export function isWeightUnit(unit: string): boolean {
	return WEIGHT_UNITS.has(unit.toLowerCase().trim())
}

/** Convert an amount + unit to grams */
function toGrams(amount: number, unit: string): number {
	const u = unit.toLowerCase().trim()
	if (u === 'kg' || u === 'kilogram' || u === 'kilograms') return amount * 1000
	if (u === 'oz' || u === 'ounce' || u === 'ounces') return amount * 28.3495
	if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds')
		return amount * 453.592
	// default: grams
	return amount
}

function lookupProduce(name: string): ProduceEntry | null {
	const lower = name.toLowerCase().trim()
	if (PRODUCE_WEIGHTS[lower]) return PRODUCE_WEIGHTS[lower]
	const aliasKey = ALIASES[lower]
	if (aliasKey && PRODUCE_WEIGHTS[aliasKey]) return PRODUCE_WEIGHTS[aliasKey]
	// Substring match: check if the name ends with a known produce key
	// (e.g., "large carrot" → "carrot")
	// Sort by key length descending so "cherry tomato" matches before "tomato"
	let bestMatch: ProduceEntry | null = null
	let bestLen = 0
	for (const [key, entry] of Object.entries(PRODUCE_WEIGHTS)) {
		if (
			(lower.endsWith(key) || lower.endsWith(entry.plural)) &&
			key.length > bestLen
		) {
			bestMatch = entry
			bestLen = key.length
		}
	}
	return bestMatch
}

/**
 * For a produce item with a weight-based quantity, returns a human-friendly
 * count string like "~2 carrots (300 g)".
 * Returns null if the item isn't a known produce item or doesn't have a weight unit.
 */
export function getProduceCountDisplay(
	name: string,
	amount: number,
	unit: string,
): string | null {
	if (!isWeightUnit(unit)) return null

	const entry = lookupProduce(name)
	if (!entry) return null

	const grams = toGrams(amount, unit)
	const count = grams / entry.weightGrams

	// Don't show if it rounds to 0
	if (count < 0.3) return null

	const rounded = Math.round(count)
	const displayCount = rounded < 1 ? 1 : rounded
	const label = displayCount === 1 ? entry.singular : entry.plural

	return `~${displayCount} ${label}`
}
