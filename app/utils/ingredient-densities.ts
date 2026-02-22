/**
 * Static ingredient density table for metric conversions.
 *
 * Maps normalized ingredient names to grams per cup, enabling
 * accurate cup-to-gram conversions that vary by ingredient
 * (1 cup flour ~120g vs 1 cup sugar ~200g).
 *
 * Sources: King Arthur Baking, USDA FoodData Central.
 */

type DensityEntry = {
	keys: string[]
	gramsPerCup: number
	isLiquid?: boolean
}

const DENSITY_DATA: DensityEntry[] = [
	// --- Liquids ---
	{
		keys: ['water'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['milk', 'whole milk', 'skim milk', 'buttermilk'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['heavy cream', 'whipping cream', 'cream'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['half and half', 'half-and-half'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: [
			'olive oil',
			'vegetable oil',
			'canola oil',
			'oil',
			'coconut oil',
			'avocado oil',
			'sesame oil',
			'peanut oil',
		],
		gramsPerCup: 216,
		isLiquid: true,
	},
	{
		keys: ['honey'],
		gramsPerCup: 340,
		isLiquid: true,
	},
	{
		keys: ['maple syrup'],
		gramsPerCup: 312,
		isLiquid: true,
	},
	{
		keys: ['molasses'],
		gramsPerCup: 328,
		isLiquid: true,
	},
	{
		keys: ['corn syrup'],
		gramsPerCup: 328,
		isLiquid: true,
	},
	{
		keys: ['soy sauce', 'tamari'],
		gramsPerCup: 255,
		isLiquid: true,
	},
	{
		keys: [
			'chicken broth',
			'chicken stock',
			'beef broth',
			'beef stock',
			'vegetable broth',
			'vegetable stock',
			'broth',
			'stock',
		],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['coconut milk'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['yogurt', 'greek yogurt'],
		gramsPerCup: 245,
		isLiquid: true,
	},
	{
		keys: ['sour cream'],
		gramsPerCup: 230,
		isLiquid: true,
	},
	{
		keys: ['tomato sauce'],
		gramsPerCup: 245,
		isLiquid: true,
	},
	{
		keys: ['vinegar', 'white vinegar', 'apple cider vinegar', 'rice vinegar'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['lemon juice', 'lime juice'],
		gramsPerCup: 244,
		isLiquid: true,
	},

	// --- Flours & Starches ---
	{
		keys: ['flour', 'all purpose flour', 'ap flour', 'plain flour'],
		gramsPerCup: 120,
	},
	{
		keys: ['bread flour'],
		gramsPerCup: 130,
	},
	{
		keys: ['cake flour', 'pastry flour'],
		gramsPerCup: 114,
	},
	{
		keys: ['whole wheat flour'],
		gramsPerCup: 128,
	},
	{
		keys: ['almond flour', 'almond meal'],
		gramsPerCup: 96,
	},
	{
		keys: ['coconut flour'],
		gramsPerCup: 128,
	},
	{
		keys: ['oat flour'],
		gramsPerCup: 120,
	},
	{
		keys: ['cornstarch', 'corn starch'],
		gramsPerCup: 128,
	},
	{
		keys: ['cornmeal'],
		gramsPerCup: 156,
	},
	{
		keys: ['tapioca starch', 'tapioca flour'],
		gramsPerCup: 120,
	},

	// --- Sugars ---
	{
		keys: ['sugar', 'granulated sugar', 'white sugar', 'caster sugar'],
		gramsPerCup: 200,
	},
	{
		keys: ['brown sugar', 'light brown sugar', 'dark brown sugar'],
		gramsPerCup: 220,
	},
	{
		keys: [
			'powdered sugar',
			'confectioner sugar',
			'icing sugar',
			'confectioners sugar',
		],
		gramsPerCup: 120,
	},

	// --- Fats ---
	{
		keys: ['butter'],
		gramsPerCup: 227,
	},
	{
		keys: ['shortening', 'lard'],
		gramsPerCup: 205,
	},
	{
		keys: ['cream cheese'],
		gramsPerCup: 232,
	},
	{
		keys: ['peanut butter', 'almond butter', 'cashew butter'],
		gramsPerCup: 258,
	},

	// --- Grains & Pasta ---
	{
		keys: ['rice', 'white rice', 'long grain rice', 'basmati rice'],
		gramsPerCup: 185,
	},
	{
		keys: ['brown rice'],
		gramsPerCup: 190,
	},
	{
		keys: ['rolled oat', 'oat', 'old fashioned oat'],
		gramsPerCup: 90,
	},
	{
		keys: ['quinoa'],
		gramsPerCup: 170,
	},
	{
		keys: ['couscous'],
		gramsPerCup: 173,
	},
	{
		keys: ['breadcrumb', 'panko'],
		gramsPerCup: 108,
	},

	// --- Nuts & Seeds ---
	{
		keys: ['almond', 'sliced almond', 'slivered almond'],
		gramsPerCup: 143,
	},
	{
		keys: ['walnut', 'pecan', 'chopped walnut', 'chopped pecan'],
		gramsPerCup: 120,
	},
	{
		keys: ['peanut'],
		gramsPerCup: 146,
	},
	{
		keys: ['cashew'],
		gramsPerCup: 137,
	},
	{
		keys: ['sesame seed'],
		gramsPerCup: 144,
	},
	{
		keys: ['chia seed'],
		gramsPerCup: 163,
	},
	{
		keys: ['flaxseed', 'flax seed', 'ground flax'],
		gramsPerCup: 149,
	},
	{
		keys: ['sunflower seed'],
		gramsPerCup: 140,
	},
	{
		keys: ['coconut', 'shredded coconut', 'desiccated coconut'],
		gramsPerCup: 93,
	},

	// --- Dairy & Cheese ---
	{
		keys: ['parmesan', 'parmigiano', 'grated parmesan'],
		gramsPerCup: 100,
	},
	{
		keys: ['cheddar', 'shredded cheddar', 'grated cheddar'],
		gramsPerCup: 113,
	},
	{
		keys: ['mozzarella', 'shredded mozzarella'],
		gramsPerCup: 113,
	},
	{
		keys: ['ricotta'],
		gramsPerCup: 246,
	},

	// --- Dried Fruit ---
	{
		keys: ['raisin'],
		gramsPerCup: 145,
	},
	{
		keys: ['dried cranberry', 'cranberry', 'craisin'],
		gramsPerCup: 120,
	},
	{
		keys: ['chocolate chip'],
		gramsPerCup: 170,
	},
	{
		keys: ['cocoa powder', 'cocoa', 'unsweetened cocoa'],
		gramsPerCup: 85,
	},

	// --- Other ---
	{
		keys: ['tomato paste'],
		gramsPerCup: 262,
	},
	{
		keys: ['tahini'],
		gramsPerCup: 240,
	},
	{
		keys: ['mayonnaise', 'mayo'],
		gramsPerCup: 220,
	},
	{
		keys: ['ketchup'],
		gramsPerCup: 240,
		isLiquid: true,
	},
	{
		keys: ['jam', 'jelly', 'preserves', 'marmalade'],
		gramsPerCup: 320,
	},
	{
		keys: ['salt', 'table salt'],
		gramsPerCup: 288,
	},
]

/**
 * Map from normalized ingredient name to density info.
 * Built at module load for O(1) lookups.
 */
const DENSITY_MAP = new Map<
	string,
	{ gramsPerCup: number; isLiquid: boolean }
>()
for (const entry of DENSITY_DATA) {
	for (const key of entry.keys) {
		DENSITY_MAP.set(key, {
			gramsPerCup: entry.gramsPerCup,
			isLiquid: entry.isLiquid ?? false,
		})
	}
}

/** Sorted keys longest-first for substring matching */
const SORTED_KEYS = [...DENSITY_MAP.keys()].sort(
	(a, b) => b.length - a.length,
)

/**
 * Lightweight normalization for density lookups.
 * Lowercase, trim, strip trailing plurals.
 * No server-only dependencies so this stays client-importable.
 */
function simplifyName(name: string): string {
	let s = name.toLowerCase().trim()
	if (s.endsWith('ies')) {
		s = s.slice(0, -3) + 'y'
	} else if (
		s.endsWith('es') &&
		!s.endsWith('ches') &&
		!s.endsWith('shes') &&
		!s.endsWith('ses')
	) {
		s = s.slice(0, -2)
	} else if (s.endsWith('s') && !s.endsWith('ss')) {
		s = s.slice(0, -1)
	}
	return s
}

/**
 * Look up density for an ingredient name.
 * Uses exact match first, then substring match (longest key first).
 *
 * @returns density info or null if unknown
 */
export function getDensity(
	ingredientName: string,
): { gramsPerCup: number; isLiquid: boolean } | null {
	const lower = ingredientName.toLowerCase().trim()

	// Try raw lowercase first (handles mass nouns like "molasses")
	const rawMatch = DENSITY_MAP.get(lower)
	if (rawMatch) return rawMatch

	const simplified = simplifyName(ingredientName)

	// Exact match on simplified
	if (simplified !== lower) {
		const exact = DENSITY_MAP.get(simplified)
		if (exact) return exact
	}

	// Substring match (longest key first, try both raw and simplified)
	for (const key of SORTED_KEYS) {
		if (lower.includes(key) || simplified.includes(key)) {
			return DENSITY_MAP.get(key)!
		}
	}

	return null
}
