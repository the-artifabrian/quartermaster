/**
 * Unit conversion for shopping list consolidation.
 *
 * Converts compatible units within the same measurement family
 * (e.g., tsp → tbsp → cup) so the shopping list can sum quantities.
 */

type UnitFamily = {
	name: string
	/** Base unit is the smallest; all factors are relative to it */
	baseUnit: string
	/** Map from normalized unit name → factor relative to base */
	units: Record<string, number>
}

const UNIT_FAMILIES: UnitFamily[] = [
	{
		name: 'volume',
		baseUnit: 'ml',
		units: {
			ml: 1,
			tsp: 4.929,
			tbsp: 14.787,
			'fl oz': 29.574,
			cup: 236.588,
			pint: 473.176,
			quart: 946.353,
			l: 1000,
			gallon: 3785.41,
		},
	},
	{
		name: 'weight',
		baseUnit: 'g',
		units: {
			g: 1,
			oz: 28.3495,
			lb: 453.592,
			kg: 1000,
		},
	},
]

/** Map of aliases to their canonical unit name */
const UNIT_ALIASES: Record<string, string> = {
	// US volume
	teaspoon: 'tsp',
	teaspoons: 'tsp',
	tsps: 'tsp',
	tablespoon: 'tbsp',
	tablespoons: 'tbsp',
	tbsps: 'tbsp',
	'fluid ounce': 'fl oz',
	'fluid ounces': 'fl oz',
	'fl ozs': 'fl oz',
	cups: 'cup',
	pints: 'pint',
	pt: 'pint',
	pts: 'pint',
	quarts: 'quart',
	qt: 'quart',
	qts: 'quart',
	gallons: 'gallon',
	gal: 'gallon',
	// US weight
	ounce: 'oz',
	ounces: 'oz',
	ozs: 'oz',
	pound: 'lb',
	pounds: 'lb',
	lbs: 'lb',
	// Metric volume
	milliliter: 'ml',
	milliliters: 'ml',
	millilitre: 'ml',
	millilitres: 'ml',
	mls: 'ml',
	liter: 'l',
	liters: 'l',
	litre: 'l',
	litres: 'l',
	// Metric weight
	gram: 'g',
	grams: 'g',
	kilogram: 'kg',
	kilograms: 'kg',
	kgs: 'kg',
}

/**
 * Normalize a unit string to its canonical form.
 * "tablespoons" → "tbsp", "Cups" → "cup", etc.
 */
export function normalizeUnit(unit: string): string {
	const lower = unit.toLowerCase().trim()
	return UNIT_ALIASES[lower] ?? lower
}

/**
 * Count-like units that are equivalent to unitless (empty string).
 * "3 eggs" and "3 count eggs" should be treated the same.
 */
const COUNT_UNITS = new Set(['count', 'each', 'whole', 'piece', 'pieces'])

/**
 * Check if a normalized unit is a count-like unit (or empty).
 * Used by subtraction and dedup to treat "3 eggs" and "3 count eggs" as compatible.
 */
export function isCountUnit(normalizedUnit: string): boolean {
	return normalizedUnit === '' || COUNT_UNITS.has(normalizedUnit)
}

/**
 * Find which unit family a normalized unit belongs to.
 * Returns null if the unit isn't in any known family.
 */
export function getUnitFamily(
	normalizedUnit: string,
): { family: UnitFamily; factor: number } | null {
	for (const family of UNIT_FAMILIES) {
		const factor = family.units[normalizedUnit]
		if (factor !== undefined) {
			return { family, factor }
		}
	}
	return null
}

/** Round to at most 2 decimal places, stripping trailing zeroes. */
function round2(n: number): number {
	return Math.round(n * 100) / 100
}

/**
 * Pick the best display unit for a value in base units.
 * Prefers units that appeared in the input (inputUnits).
 * Among candidates, chooses the largest where value ≥ ~1 (0.99 tolerance for floating point).
 */
function pickBestUnit(
	baseValue: number,
	family: UnitFamily,
	inputUnits: Set<string>,
): { value: number; unit: string } {
	// Sort units by factor descending (largest first)
	const sorted = Object.entries(family.units).sort(([, a], [, b]) => b - a)

	// First pass: prefer units that appeared in the input
	for (const [unitName, factor] of sorted) {
		if (!inputUnits.has(unitName)) continue
		const converted = baseValue / factor
		// Use small tolerance to avoid floating point near-misses (e.g., 0.9999… < 1)
		if (converted >= 0.99) {
			return { value: round2(converted), unit: unitName }
		}
	}

	// Second pass: any unit in the family
	for (const [unitName, factor] of sorted) {
		const converted = baseValue / factor
		if (converted >= 0.99) {
			return { value: round2(converted), unit: unitName }
		}
	}

	// Fallback to base unit
	return { value: round2(baseValue), unit: family.baseUnit }
}

/**
 * Convert and sum a list of quantities that are in compatible units.
 * All quantities must be in the same unit family.
 * Returns the summed value in the best display unit, preferring
 * units that appeared in the input.
 */
export function convertAndSum(
	quantities: Array<{ amount: number; normalizedUnit: string }>,
	family: UnitFamily,
): { value: number; unit: string } {
	let totalBase = 0
	const inputUnits = new Set<string>()

	for (const q of quantities) {
		const factor = family.units[q.normalizedUnit]
		if (factor === undefined) {
			throw new Error(
				`Unit "${q.normalizedUnit}" not in family "${family.name}"`,
			)
		}
		totalBase += q.amount * factor
		inputUnits.add(q.normalizedUnit)
	}

	return pickBestUnit(totalBase, family, inputUnits)
}
