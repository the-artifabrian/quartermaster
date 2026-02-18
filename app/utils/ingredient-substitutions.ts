/**
 * Static ingredient substitution database.
 *
 * ~50 common substitution entries covering dairy, eggs, fats, leavening,
 * thickeners, condiments, acids, herbs, sweeteners, and starches.
 * Lookup is keyed by normalized ingredient name (uses substring matching
 * against post-normalization names, sorted longest-first).
 *
 * Pattern follows shelf-life.ts and pantry-staples.ts.
 */

export type Substitution = {
	/** What to use instead, e.g. "1 cup milk + 1 tbsp lemon juice" */
	replacement: string
	/** Extra context, e.g. "Let sit 5 min. Works for baking." */
	context?: string
	/** Ratio info, e.g. "per 1 cup buttermilk" */
	ratio?: string
}

type SubstitutionEntry = {
	/** Post-normalization names that trigger this entry */
	keys: string[]
	substitutions: Substitution[]
}

const SUBSTITUTION_DATA: SubstitutionEntry[] = [
	// --- Dairy ---
	{
		keys: ['buttermilk'],
		substitutions: [
			{
				replacement: 'milk + lemon juice',
				ratio: 'per 1 cup',
				context: '1 cup milk + 1 tbsp lemon juice. Let sit 5 min.',
			},
			{
				replacement: 'milk + white vinegar',
				ratio: 'per 1 cup',
				context: '1 cup milk + 1 tbsp white vinegar. Let sit 5 min.',
			},
			{
				replacement: 'yogurt + milk',
				ratio: 'per 1 cup',
				context: '¾ cup yogurt thinned with ¼ cup milk.',
			},
		],
	},
	{
		keys: ['heavy cream', 'whipping cream'],
		substitutions: [
			{
				replacement: 'coconut cream',
				context: 'Works in soups, sauces, and curries.',
			},
			{
				replacement: 'milk + butter',
				ratio: 'per 1 cup',
				context: '¾ cup milk + ⅓ cup melted butter. Not whippable.',
			},
		],
	},
	{
		keys: ['sour cream'],
		substitutions: [
			{
				replacement: 'Greek yogurt',
				context: 'Equal swap. Slightly tangier.',
			},
			{
				replacement: 'cream cheese + milk',
				context: 'Thin cream cheese with a splash of milk.',
			},
		],
	},
	{
		keys: ['cream cheese'],
		substitutions: [
			{
				replacement: 'Greek yogurt',
				context: 'Works for dips and spreads. Not for cheesecake.',
			},
			{
				replacement: 'mascarpone',
				context: 'Richer flavor but similar texture.',
			},
		],
	},
	{
		keys: ['yogurt', 'greek yogurt'],
		substitutions: [
			{
				replacement: 'sour cream',
				context: 'Equal swap in baking and dressings.',
			},
			{
				replacement: 'buttermilk',
				context: 'Thinner — reduce other liquids slightly.',
			},
		],
	},
	{
		keys: ['milk'],
		substitutions: [
			{
				replacement: 'oat milk',
				context: 'Best plant-based swap for baking.',
			},
			{
				replacement: 'almond milk',
				context: 'Lighter flavor. Works in most recipes.',
			},
			{
				replacement: 'water + butter',
				ratio: 'per 1 cup',
				context: '1 cup water + 1 tbsp butter. For baking only.',
			},
		],
	},
	{
		keys: ['butter'],
		substitutions: [
			{
				replacement: 'coconut oil',
				context: 'Equal swap. Adds slight coconut flavor.',
			},
			{
				replacement: 'olive oil',
				ratio: 'per 1 cup butter',
				context: '¾ cup olive oil. Best for savory dishes.',
			},
			{
				replacement: 'applesauce',
				ratio: 'per 1 cup butter',
				context: '½ cup applesauce. For baking — reduces fat.',
			},
		],
	},
	{
		keys: ['parmesan', 'parmigiano'],
		substitutions: [
			{
				replacement: 'pecorino romano',
				context: 'Saltier and sharper — use slightly less.',
			},
			{
				replacement: 'nutritional yeast',
				context: 'Vegan option. Use 2-3 tbsp per ¼ cup parmesan.',
			},
		],
	},

	// --- Eggs ---
	{
		keys: ['egg'],
		substitutions: [
			{
				replacement: 'flax egg',
				ratio: 'per 1 egg',
				context: '1 tbsp ground flax + 3 tbsp water. Rest 5 min.',
			},
			{
				replacement: 'mashed banana',
				ratio: 'per 1 egg',
				context: '¼ cup mashed banana. Adds sweetness.',
			},
			{
				replacement: 'applesauce',
				ratio: 'per 1 egg',
				context: '¼ cup applesauce. Works in moist baked goods.',
			},
		],
	},

	// --- Leavening ---
	{
		keys: ['baking powder'],
		substitutions: [
			{
				replacement: 'baking soda + cream of tartar',
				ratio: 'per 1 tsp',
				context: '¼ tsp baking soda + ½ tsp cream of tartar.',
			},
		],
	},
	{
		keys: ['baking soda'],
		substitutions: [
			{
				replacement: 'baking powder',
				ratio: 'per 1 tsp baking soda',
				context: 'Use 3 tsp baking powder. Remove acidic liquid.',
			},
		],
	},

	// --- Thickeners ---
	{
		keys: ['cornstarch'],
		substitutions: [
			{
				replacement: 'all-purpose flour',
				ratio: 'per 1 tbsp cornstarch',
				context: 'Use 2 tbsp flour. Sauce will be less glossy.',
			},
			{
				replacement: 'arrowroot powder',
				context: 'Equal swap. Freezes better than cornstarch.',
			},
		],
	},
	{
		keys: ['flour'],
		substitutions: [
			{
				replacement: 'almond flour',
				context: 'Use 1:1 but add extra egg. Denser texture.',
			},
			{
				replacement: 'oat flour',
				context: 'Blend rolled oats. 1:1 swap for most baking.',
			},
		],
	},

	// --- Oils & Fats ---
	{
		keys: ['olive oil'],
		substitutions: [
			{
				replacement: 'avocado oil',
				context: 'Neutral flavor, higher smoke point.',
			},
			{
				replacement: 'butter',
				ratio: 'per 1 cup olive oil',
				context: 'Use 1 cup + 2 tbsp butter. For baking.',
			},
		],
	},
	{
		keys: ['vegetable oil', 'canola oil'],
		substitutions: [
			{
				replacement: 'melted coconut oil',
				context: 'Equal swap. May add mild coconut flavor.',
			},
			{
				replacement: 'applesauce',
				context: 'Equal swap for baking. Reduces fat content.',
			},
		],
	},
	{
		keys: ['sesame oil'],
		substitutions: [
			{
				replacement: 'peanut oil + soy sauce',
				context:
					'A few drops of soy sauce with peanut oil approximates the flavor.',
			},
		],
	},

	// --- Acids & Vinegars ---
	{
		keys: ['lemon juice', 'lemon'],
		substitutions: [
			{
				replacement: 'lime juice',
				context: 'Equal swap. Slightly different flavor profile.',
			},
			{
				replacement: 'white wine vinegar',
				ratio: 'per 1 tbsp',
				context: '½ tbsp vinegar. More acidic — use less.',
			},
		],
	},
	{
		keys: ['lime juice', 'lime'],
		substitutions: [
			{
				replacement: 'lemon juice',
				context: 'Equal swap. Works in most recipes.',
			},
		],
	},
	{
		keys: ['white wine vinegar'],
		substitutions: [
			{
				replacement: 'apple cider vinegar',
				context: 'Equal swap. Slightly fruity.',
			},
			{
				replacement: 'rice vinegar',
				context: 'Equal swap. Milder acidity.',
			},
		],
	},
	{
		keys: ['rice vinegar'],
		substitutions: [
			{
				replacement: 'apple cider vinegar',
				context: 'Equal swap. Add a pinch of sugar.',
			},
			{
				replacement: 'white wine vinegar',
				context: 'Equal swap. Slightly sharper.',
			},
		],
	},
	{
		keys: ['apple cider vinegar'],
		substitutions: [
			{
				replacement: 'white wine vinegar',
				context: 'Equal swap.',
			},
			{
				replacement: 'lemon juice',
				context: 'Equal swap for dressings and marinades.',
			},
		],
	},
	{
		keys: ['wine', 'white wine'],
		substitutions: [
			{
				replacement: 'chicken broth + lemon juice',
				context: 'Equal amount broth plus a squeeze of lemon.',
			},
			{
				replacement: 'apple juice',
				context: 'For deglazing. Adds sweetness.',
			},
		],
	},
	{
		keys: ['red wine'],
		substitutions: [
			{
				replacement: 'beef broth + red wine vinegar',
				context: 'Equal broth plus 1 tbsp vinegar per cup.',
			},
			{
				replacement: 'grape juice',
				context: 'Non-alcoholic option. Add splash of vinegar.',
			},
		],
	},

	// --- Condiments & Sauces ---
	{
		keys: ['soy sauce'],
		substitutions: [
			{
				replacement: 'tamari',
				context: 'Equal swap. Gluten-free option.',
			},
			{
				replacement: 'coconut aminos',
				context: 'Less salty, slightly sweet. Use a bit more.',
			},
		],
	},
	{
		keys: ['fish sauce'],
		substitutions: [
			{
				replacement: 'soy sauce + lime juice',
				context: '1 tbsp soy sauce + squeeze of lime per 1 tbsp fish sauce.',
			},
			{
				replacement: 'Worcestershire sauce',
				context: 'Similar umami depth. Equal swap.',
			},
		],
	},
	{
		keys: ['worcestershire sauce', 'worcestershire'],
		substitutions: [
			{
				replacement: 'soy sauce + lemon juice',
				context: 'Equal parts. Approximates the tang.',
			},
		],
	},
	{
		keys: ['dijon mustard', 'mustard'],
		substitutions: [
			{
				replacement: 'yellow mustard',
				context: 'Milder flavor. Use same amount.',
			},
			{
				replacement: 'horseradish + vinegar',
				context: 'Small amount for the sharp kick.',
			},
		],
	},
	{
		keys: ['mayonnaise', 'mayo'],
		substitutions: [
			{
				replacement: 'Greek yogurt',
				context: 'Lower fat. Works in dressings and sandwiches.',
			},
			{
				replacement: 'mashed avocado',
				context: 'Good for sandwiches and wraps.',
			},
		],
	},
	{
		keys: ['tomato paste'],
		substitutions: [
			{
				replacement: 'tomato sauce',
				ratio: 'per 1 tbsp paste',
				context: 'Use 3 tbsp sauce and reduce liquid elsewhere.',
			},
			{
				replacement: 'ketchup',
				context: 'In a pinch. Adds sweetness — reduce sugar.',
			},
		],
	},
	{
		keys: ['tomato sauce'],
		substitutions: [
			{
				replacement: 'tomato paste + water',
				ratio: 'per 1 cup sauce',
				context: '⅓ cup paste + ⅔ cup water.',
			},
		],
	},

	// --- Sweeteners ---
	{
		keys: ['honey'],
		substitutions: [
			{
				replacement: 'maple syrup',
				context: 'Equal swap. Different flavor profile.',
			},
			{
				replacement: 'agave nectar',
				context: 'Equal swap. More neutral flavor.',
			},
		],
	},
	{
		keys: ['maple syrup'],
		substitutions: [
			{
				replacement: 'honey',
				context: 'Equal swap. Slightly different flavor.',
			},
			{
				replacement: 'brown sugar',
				ratio: 'per 1 cup syrup',
				context: '¾ cup brown sugar. Add 3 tbsp liquid.',
			},
		],
	},
	{
		keys: ['brown sugar'],
		substitutions: [
			{
				replacement: 'white sugar + molasses',
				ratio: 'per 1 cup',
				context: '1 cup white sugar + 1 tbsp molasses.',
			},
			{
				replacement: 'coconut sugar',
				context: 'Equal swap. Slightly less sweet.',
			},
		],
	},

	// --- Herbs & Spices ---
	{
		keys: ['fresh basil', 'basil'],
		substitutions: [
			{
				replacement: 'dried basil',
				ratio: 'per 1 tbsp fresh',
				context: 'Use 1 tsp dried.',
			},
			{
				replacement: 'fresh oregano',
				context: 'Different flavor but works in Italian dishes.',
			},
		],
	},
	{
		keys: ['fresh cilantro', 'cilantro'],
		substitutions: [
			{
				replacement: 'fresh parsley + lime zest',
				context: 'Parsley for color, lime zest for brightness.',
			},
		],
	},
	{
		keys: ['fresh parsley', 'parsley'],
		substitutions: [
			{
				replacement: 'dried parsley',
				ratio: 'per 1 tbsp fresh',
				context: 'Use 1 tsp dried. Less vibrant.',
			},
			{
				replacement: 'fresh cilantro',
				context: 'Different flavor — works in some dishes.',
			},
		],
	},
	{
		keys: ['fresh rosemary', 'rosemary'],
		substitutions: [
			{
				replacement: 'dried rosemary',
				ratio: 'per 1 tbsp fresh',
				context: 'Use 1 tsp dried. Crush before using.',
			},
			{
				replacement: 'fresh thyme',
				context: 'Similar woodsy flavor.',
			},
		],
	},
	{
		keys: ['fresh thyme', 'thyme'],
		substitutions: [
			{
				replacement: 'dried thyme',
				ratio: 'per 1 tbsp fresh',
				context: 'Use 1 tsp dried.',
			},
		],
	},

	// --- Starches & Grains ---
	{
		keys: ['breadcrumb', 'panko'],
		substitutions: [
			{
				replacement: 'crushed crackers',
				context: 'Similar crunch. Works for coating.',
			},
			{
				replacement: 'rolled oats',
				context: 'Pulse in blender. Good for meatballs and binders.',
			},
		],
	},

	// --- Broths & Stocks ---
	{
		keys: ['chicken broth', 'chicken stock'],
		substitutions: [
			{
				replacement: 'vegetable broth',
				context: 'Equal swap. Good for lighter flavor.',
			},
			{
				replacement: 'water + bouillon cube',
				context: '1 cube per 1 cup water.',
			},
		],
	},
	{
		keys: ['beef broth', 'beef stock'],
		substitutions: [
			{
				replacement: 'mushroom broth',
				context: 'Rich umami flavor. Equal swap.',
			},
			{
				replacement: 'soy sauce + water',
				ratio: 'per 1 cup',
				context: '1 tbsp soy sauce + 1 cup water.',
			},
		],
	},
	{
		keys: ['vegetable broth', 'vegetable stock'],
		substitutions: [
			{
				replacement: 'chicken broth',
				context: 'Equal swap if not vegetarian.',
			},
			{
				replacement: 'water + bouillon cube',
				context: '1 cube per 1 cup water.',
			},
		],
	},

	// --- Miscellaneous ---
	{
		keys: ['coconut milk'],
		substitutions: [
			{
				replacement: 'heavy cream',
				context: 'Equal swap for curries and soups.',
			},
			{
				replacement: 'oat milk + coconut oil',
				context: '1 cup oat milk + 1 tbsp coconut oil for richness.',
			},
		],
	},
	{
		keys: ['mirin'],
		substitutions: [
			{
				replacement: 'rice vinegar + sugar',
				ratio: 'per 1 tbsp mirin',
				context: '1 tbsp rice vinegar + ½ tsp sugar.',
			},
			{
				replacement: 'dry sherry',
				context: 'Equal swap.',
			},
		],
	},
	{
		keys: ['tahini'],
		substitutions: [
			{
				replacement: 'peanut butter',
				context: 'Thinned with a little oil. Different flavor.',
			},
			{
				replacement: 'cashew butter',
				context: 'Milder flavor, similar texture.',
			},
		],
	},
	{
		keys: ['molasses'],
		substitutions: [
			{
				replacement: 'dark corn syrup',
				context: 'Equal swap. Less complex flavor.',
			},
			{
				replacement: 'honey + brown sugar',
				ratio: 'per 1 cup molasses',
				context: '¾ cup honey + ¼ cup brown sugar.',
			},
		],
	},
	{
		keys: ['half and half', 'half-and-half'],
		substitutions: [
			{
				replacement: 'milk + cream',
				ratio: 'per 1 cup',
				context: '½ cup whole milk + ½ cup heavy cream.',
			},
			{
				replacement: 'whole milk + butter',
				ratio: 'per 1 cup',
				context: '1 cup milk + 1 tbsp melted butter.',
			},
		],
	},
	{
		keys: ['ricotta'],
		substitutions: [
			{
				replacement: 'cottage cheese',
				context: 'Blend until smooth for similar texture.',
			},
			{
				replacement: 'cream cheese',
				context: 'Richer, denser. Thin with milk if needed.',
			},
		],
	},
	{
		keys: ['shallot'],
		substitutions: [
			{
				replacement: 'red onion',
				context: 'Use slightly less. Milder when raw.',
			},
		],
	},
	{
		keys: ['leek'],
		substitutions: [
			{
				replacement: 'green onion',
				context: 'Use the white and light green parts.',
			},
			{
				replacement: 'shallot',
				context: 'Milder onion flavor.',
			},
		],
	},

	// --- Alliums & Aromatics ---
	{
		keys: ['garlic'],
		substitutions: [
			{
				replacement: 'garlic powder',
				ratio: 'per 1 clove',
				context: '⅛ tsp garlic powder per clove. Add early in cooking.',
			},
			{
				replacement: 'shallot',
				context: 'Milder, slightly sweet. Use 1 small shallot per 2 cloves.',
			},
		],
	},
	{
		keys: ['onion'],
		substitutions: [
			{
				replacement: 'shallot',
				context: 'Milder, sweeter. 3 shallots ≈ 1 medium onion.',
			},
			{
				replacement: 'onion powder',
				ratio: 'per 1 medium onion',
				context: '1 tbsp onion powder. For cooked dishes.',
			},
		],
	},
	{
		keys: ['ginger'],
		substitutions: [
			{
				replacement: 'ground ginger',
				ratio: 'per 1 tbsp fresh',
				context: '¼ tsp ground ginger. Less pungent.',
			},
			{
				replacement: 'galangal',
				context: 'Citrusy, piney. Works in Thai/Southeast Asian dishes.',
			},
		],
	},

	// --- Spices ---
	{
		keys: ['cumin'],
		substitutions: [
			{
				replacement: 'coriander',
				context: 'Earthy but different. Use same amount.',
			},
			{
				replacement: 'chili powder',
				context: 'Most chili powders contain cumin. Use slightly less.',
			},
		],
	},
	{
		keys: ['cinnamon'],
		substitutions: [
			{
				replacement: 'allspice',
				ratio: 'per 1 tsp cinnamon',
				context: '¼ to ½ tsp allspice. Stronger — use less.',
			},
			{
				replacement: 'nutmeg',
				ratio: 'per 1 tsp cinnamon',
				context: '¼ tsp nutmeg. Warmer, more pungent.',
			},
		],
	},
	{
		keys: ['nutmeg'],
		substitutions: [
			{
				replacement: 'cinnamon',
				context: 'Sweeter, less pungent. Use same amount.',
			},
			{
				replacement: 'allspice',
				ratio: 'per 1 tsp nutmeg',
				context: '½ tsp allspice. Similar warmth.',
			},
		],
	},
	{
		keys: ['paprika'],
		substitutions: [
			{
				replacement: 'chili powder',
				context: 'More heat. Use half the amount to start.',
			},
			{
				replacement: 'cayenne + sugar',
				ratio: 'per 1 tsp paprika',
				context: 'Pinch of cayenne + pinch of sugar. For color and mild heat.',
			},
		],
	},

	// --- Proteins ---
	{
		keys: ['ground beef'],
		substitutions: [
			{
				replacement: 'ground turkey',
				context: 'Leaner. Add a splash of oil for moisture.',
			},
			{
				replacement: 'ground pork',
				context: 'Richer flavor. Equal swap.',
			},
		],
	},
	{
		keys: ['chicken breast'],
		substitutions: [
			{
				replacement: 'chicken thigh',
				context: 'More flavorful and forgiving. Adjust cook time.',
			},
			{
				replacement: 'turkey breast',
				context: 'Leaner, similar texture. Equal swap.',
			},
		],
	},
	{
		keys: ['bacon'],
		substitutions: [
			{
				replacement: 'pancetta',
				context: 'Italian unsmoked bacon. Dice and crisp.',
			},
			{
				replacement: 'smoked turkey',
				context: 'Leaner. Provides smoky flavor.',
			},
		],
	},

	// --- Cheeses ---
	{
		keys: ['cheddar'],
		substitutions: [
			{
				replacement: 'gruyère',
				context: 'Nuttier, melts beautifully. Great for mac and cheese.',
			},
			{
				replacement: 'gouda',
				context: 'Creamy, slightly sweet. Similar melt.',
			},
		],
	},
	{
		keys: ['mozzarella'],
		substitutions: [
			{
				replacement: 'provolone',
				context: 'Sharper flavor, similar melt for pizza and bakes.',
			},
			{
				replacement: 'monterey jack',
				context: 'Mild, great melting cheese. Equal swap.',
			},
		],
	},

	// --- Other ---
	{
		keys: ['tofu'],
		substitutions: [
			{
				replacement: 'tempeh',
				context: 'Firmer, nuttier. Slice thin and marinate.',
			},
			{
				replacement: 'paneer',
				context: 'Indian fresh cheese. Similar texture when cubed.',
			},
		],
	},
	{
		keys: ['coconut cream'],
		substitutions: [
			{
				replacement: 'heavy cream',
				context: 'Equal swap. No coconut flavor.',
			},
			{
				replacement: 'full-fat coconut milk',
				context: 'Refrigerate overnight, scoop the thick top layer.',
			},
		],
	},
]

/**
 * Map from normalized ingredient name → substitutions.
 * Built at module load for O(1) lookups.
 */
const SUBSTITUTION_MAP = new Map<string, Substitution[]>()
for (const entry of SUBSTITUTION_DATA) {
	for (const key of entry.keys) {
		SUBSTITUTION_MAP.set(key, entry.substitutions)
	}
}

/** Sorted keys longest-first for substring matching */
const SORTED_KEYS = [...SUBSTITUTION_MAP.keys()].sort(
	(a, b) => b.length - a.length,
)

/**
 * Lightweight normalization: lowercase, trim, strip trailing "s"/"es".
 * Matches the approach in shelf-life.ts for client-importable code.
 */
function simplifyName(name: string): string {
	let s = name.toLowerCase().trim()
	if (s.endsWith('ies')) {
		s = s.slice(0, -3) + 'y'
	} else if (s.endsWith('es') && !s.endsWith('ches') && !s.endsWith('shes')) {
		s = s.slice(0, -2)
	} else if (s.endsWith('s') && !s.endsWith('ss')) {
		s = s.slice(0, -1)
	}
	return s
}

/**
 * Strip leading quantity/size descriptors from an ingredient name.
 *
 * "Small knob of ginger" → "ginger"
 * "Large handful of basil" → "basil"
 * "Drizzle of oil" → "oil"
 * "Splash of vinegar" → "vinegar"
 * "450 g Italian sausage" → "Italian sausage"
 *
 * Used before substitution lookups and for popover header display.
 */
export function stripDescriptors(name: string): string {
	let s = name.trim()
	// Strip leading numeric amounts + units: "450 g ", "1 cup ", "2 tbsp "
	s = s.replace(
		/^[\d./½⅓⅔¼¾⅛]+\s*(?:g|kg|ml|l|cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|liters?|litres?|cloves?|sachet|sachets|bunch(?:es)?|head|heads|sticks?|pieces?|slices?|sprigs?|stalks?|strips?|pinch(?:es)?|dash(?:es)?)\b\s*/i,
		'',
	)
	// Strip size/quantity adjectives and "of": "small knob of", "large handful of", "drizzle of"
	s = s.replace(
		/^(?:small|medium|large|big|thin|thick|generous|scant|good|extra|optional)\s+/i,
		'',
	)
	s = s.replace(
		/^(?:knob|handful|drizzle|splash|squeeze|pinch|dash|sprig|bunch|head|clove|stalk|strip|slice|piece|sachet|can|tin|jar|bottle|packet|bag|box)(?:s|es)?\s+(?:of\s+)?/i,
		'',
	)
	// Strip bare "of" if still leading (e.g. after previous pass)
	s = s.replace(/^of\s+/i, '')
	return s.trim() || name.trim()
}

/**
 * Look up static substitutions for an ingredient name.
 * Uses substring matching (sorted longest-first) so
 * "low-sodium chicken stock" still matches "chicken stock".
 *
 * @param normalizedName - The ingredient name (will be simplified internally)
 * @returns Array of substitutions, or null if no match
 */
export function getStaticSubstitutions(
	normalizedName: string,
): Substitution[] | null {
	const simplified = simplifyName(normalizedName)

	// Exact match first
	const exact = SUBSTITUTION_MAP.get(simplified)
	if (exact) return exact

	// Substring match (longest key first)
	for (const key of SORTED_KEYS) {
		if (simplified.includes(key)) {
			return SUBSTITUTION_MAP.get(key)!
		}
	}

	return null
}
