/**
 * The words read as units, and what each one means. The ingredient parser,
 * the Shopping quick-add and voice parsers and unit conversion all read this
 * table, so a unit one of them knows the others know too. Client-safe.
 */

/**
 * Measures, by the name conversion works in, with the other ways of writing
 * each. Only measures are aliased.
 */
const MEASURES: Record<string, readonly string[]> = {
	tsp: ['teaspoon', 'teaspoons', 'tsps'],
	tbsp: ['tablespoon', 'tablespoons', 'tbsps'],
	'fl oz': ['fluid ounce', 'fluid ounces', 'fl ozs'],
	cup: ['cups'],
	pint: ['pints', 'pt', 'pts'],
	quart: ['quarts', 'qt', 'qts'],
	gallon: ['gallons', 'gal'],
	ml: ['milliliter', 'milliliters', 'millilitre', 'millilitres', 'mls'],
	l: ['liter', 'liters', 'litre', 'litres'],
	mg: ['milligram', 'milligrams'],
	g: ['gram', 'grams'],
	kg: ['kilogram', 'kilograms', 'kgs'],
	oz: ['ounce', 'ounces', 'ozs'],
	lb: ['pound', 'pounds', 'lbs'],
}

/**
 * Units that count something or name a pinch of it. These stay as written:
 * Shopping shows the unit of the first line it sums, so turning "cans" into
 * "can" would show "3 can".
 */
const OTHER_UNITS = [
	'bag',
	'bags',
	'bar',
	'bars',
	'bottle',
	'bottles',
	'box',
	'boxes',
	'bunch',
	'bunches',
	'can',
	'cans',
	'carton',
	'cartons',
	'case',
	'cases',
	'clove',
	'cloves',
	'container',
	'containers',
	'dash',
	'dozen',
	'dozens',
	'each',
	'half',
	'halves',
	'handful',
	'head',
	'heads',
	'jar',
	'jars',
	'loaf',
	'loaves',
	'pack',
	'packs',
	'package',
	'packages',
	'piece',
	'pieces',
	'pinch',
	'roll',
	'rolls',
	'slice',
	'slices',
	'sprig',
	'sprigs',
	'stalk',
	'stalks',
	'stick',
	'sticks',
	'tin',
	'tins',
	'tub',
	'tubs',
	'tube',
	'tubes',
]

const ALIASES = new Map(
	Object.entries(MEASURES).flatMap(([unit, aliases]) =>
		[unit, ...aliases].map((alias) => [alias, unit] as const),
	),
)

/** Every unit word in lower case, "fl oz" and "fluid ounces" among them. */
export const UNIT_WORDS: ReadonlySet<string> = new Set([
	...ALIASES.keys(),
	...OTHER_UNITS,
])

/**
 * A unit as conversion knows it: "Tablespoons" is "tbsp" and "fluid  ounce"
 * is "fl oz". Anything else comes back trimmed and in lower case.
 */
export function normalizeUnit(unit: string): string {
	const lower = unit.trim().replace(/\s+/g, ' ').toLowerCase()
	return ALIASES.get(lower) ?? lower
}

/**
 * A unit word and the word after it that together name a thing, so the
 * first word is no unit there: "pack choi", "loaf tin".
 */
const NAMES_LED_BY_A_UNIT = /^(?:pack\s+choi|loaf\s+(?:tins?|pans?))\b/i

/**
 * Unit words that also name something bought on its own: "4 rolls" are
 * rolls. When nothing after one of these is the food ("4 rolls for
 * serving"), the word is the food. A measure such as "tsp" never is.
 */
const FOOD_UNIT_WORDS = new Set([
	'roll',
	'rolls',
	'loaf',
	'loaves',
	'bar',
	'bars',
])

/** Whether a unit word can be the food itself, as "rolls" can. */
export function canBeTheFood(unitWord: string): boolean {
	return FOOD_UNIT_WORDS.has(unitWord.toLowerCase())
}

/** Whether `unitWord` followed by `rest` names a thing, as "pack choi" does. */
export function namesAThing(unitWord: string, rest: string): boolean {
	return NAMES_LED_BY_A_UNIT.test(`${unitWord} ${rest}`)
}

/**
 * Unit words that also start things people put on a Shopping list: "half and
 * half", "half gallon milk".
 */
const SHOPPING_NAME_STARTS = new Set(['half', 'halves'])

/**
 * The unit words the Shopping quick-add and voice parsers read, as a regex
 * alternation, longest first, with any space between two words matching a
 * run of spaces. Use it with the `i` flag.
 */
export const SHOPPING_UNIT_PATTERN = [...UNIT_WORDS]
	.filter((word) => !SHOPPING_NAME_STARTS.has(word))
	.sort((a, b) => b.length - a.length)
	.map((word) => word.split(' ').join(String.raw`\s+`))
	.join('|')
