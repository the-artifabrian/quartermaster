/**
 * Parsing time on long input. Recipe import reads pages up to 5 MB and a
 * paste up to MAX_RAW_TEXT_LENGTH, so every pattern that reads that text has
 * to stay linear in its length. A pattern that backtracks over its own
 * whitespace, digits or brackets holds the event loop for seconds on one
 * long line.
 *
 * Failure list:
 * - A paste line that starts with a section word and then runs to the cap
 *   in spaces ("Ingredients      …x").
 * - A paste whose title line ends in a long run of spaces before other text.
 * - A paste description line "Serves      …x", "Serves 4 a      …x" or
 *   "Serves 4 a::::…x".
 * - A paste of "++[" over and over, which looks like the start of an Apple
 *   Notes link that never closes.
 * - A paste step that is one long run of digits, or of "1.", before a step
 *   that starts with a unit.
 * - A paste ingredient line of the cap's length with a run of spaces before
 *   text that ends in a line separator once a stray ")" is dropped
 *   ("1      x\r)").
 * - Paste ingredient lines at the line cap with runs of spaces before text
 *   that never ends in "(…)", "(approx.)" or "to taste", including lines
 *   that hold "(approx." or end in "taste" somewhere else.
 * - Paste ingredient lines at the line cap with a paren after the run.
 * - JSON-LD ingredient lines at the line cap made of "[", ",(" or "(".
 * - JSON-LD text that is one long run of "<".
 * - Saved steps at the step limit made of digits, shown with Metric on, which
 *   rewrites Fahrenheit in every step on each render.
 * - JSON-LD with thousands of ingredient lines.
 * - An amount string far longer than any saved amount.
 * - A line longer than the line cap: what fits still parses, and the parse
 *   keeps more text than the fields can hold, so import still reports the
 *   ingredient as shortened instead of dropping the rest quietly.
 * - A title longer than the save limit still gives up a trailing
 *   "(Serves 2)".
 * - JSON-LD with more ingredient lines than a Recipe can hold still reports
 *   Ingredients as shortened.
 */
import { describe, expect, test } from 'vitest'
import { scaleAmount, scaleAmountKitchen } from './fractions.ts'
import { convertTemperatures } from './metric-conversion.ts'
import { fitImportedRecipe } from './import-recipe-fit.ts'
import {
	MAX_INGREDIENT_LINE_LENGTH,
	parseIngredient,
} from './ingredient-parser.ts'
import { cleanJsonLdText, extractRecipe } from './recipe-jsonld.server.ts'
import {
	extractYieldFromTitle,
	joinBrokenUnitSteps,
	parseRecipeText,
} from './recipe-text-parser.ts'
import {
	MAX_INGREDIENT_AMOUNT_LENGTH,
	MAX_INGREDIENT_NAME_LENGTH,
	MAX_INGREDIENT_NOTES_LENGTH,
	MAX_INGREDIENT_UNIT_LENGTH,
	MAX_INSTRUCTION_LENGTH,
	MAX_RAW_TEXT_LENGTH,
	MAX_RECIPE_INGREDIENTS,
} from './recipe-validation.ts'

// Generous next to the few milliseconds the linear code takes, so a slow CI
// runner stays well under it. The quadratic code took hundreds of
// milliseconds to seconds on the same input.
const BOUND_MS = 50

/** The best of three runs, so a pause for garbage collection doesn't count. */
function elapsedMs(run: () => unknown) {
	let best = Infinity
	for (let i = 0; i < 3; i++) {
		const start = performance.now()
		run()
		best = Math.min(best, performance.now() - start)
	}
	return best
}

function paste({
	title = 'Soup',
	description = [] as string[],
	ingredients = ['- salt'],
	steps = ['1. Cook'],
}) {
	return [
		title,
		...description,
		'Ingredients',
		...ingredients,
		'Instructions',
		...steps,
	].join('\n')
}

/** As many lines of `line` as fit in one paste. */
function pasteLines(line: string) {
	const count = Math.floor(MAX_RAW_TEXT_LENGTH / (line.length + 3))
	return Array.from({ length: count }, () => `- ${line}`)
}

function lineOf(head: string, fill: string, tail: string) {
	const room = MAX_INGREDIENT_LINE_LENGTH - head.length - tail.length
	return head + fill.repeat(Math.floor(room / fill.length)) + tail
}

const RUN = MAX_RAW_TEXT_LENGTH - 100

const jsonLd = (fields: Record<string, unknown>) =>
	extractRecipe(
		{ '@type': 'Recipe', name: 'Soup', ...fields },
		'https://example.com/soup',
	)

const jsonLdLines = (line: string) =>
	Array.from({ length: MAX_RECIPE_INGREDIENTS + 1 }, () => line)

const manyLines = Array.from(
	{ length: 200_000 },
	(_, i) => `${i} g flour, (sifted)`,
)

const cases: Array<[string, () => unknown]> = [
	[
		'a section word followed by a long run of spaces',
		() =>
			parseRecipeText(
				paste({ description: [`Ingredients${' '.repeat(RUN)}x`] }),
			),
	],
	[
		'a title that ends in a long run of spaces before other text',
		() => parseRecipeText(paste({ title: `Soup${' '.repeat(RUN)}x` })),
	],
	[
		'a yield line with a long run of spaces after "Serves"',
		() =>
			parseRecipeText(paste({ description: [`Serves${' '.repeat(RUN)}x`] })),
	],
	[
		'a yield line with a long run of spaces inside its label',
		() =>
			parseRecipeText(
				paste({ description: [`Serves 4 a${' '.repeat(RUN)}x`] }),
			),
	],
	[
		'a yield line whose label holds a long run of colons',
		() =>
			parseRecipeText(
				paste({ description: [`Serves 4 a${':'.repeat(RUN)}x`] }),
			),
	],
	[
		'an Apple Notes link opener repeated across the paste',
		() => parseRecipeText('++['.repeat(RUN / 3)),
	],
	[
		'a step of digits before a step that starts with a unit',
		() =>
			parseRecipeText(
				paste({ steps: [`1. ${'1'.repeat(RUN)}x`, '2. F and serve'] }),
			),
	],
	[
		'a step of "1." repeated before a step that starts with a unit',
		() =>
			joinBrokenUnitSteps([
				{ content: `${'1.'.repeat(RUN / 2)}x` },
				{ content: 'F' },
			]),
	],
	[
		'saved steps of digits shown with Metric on',
		() => {
			const step = `${'1'.repeat(MAX_INSTRUCTION_LENGTH - 1)}x`
			for (let i = 0; i < 20; i++) convertTemperatures(step)
		},
	],
	[
		'a title of spaces checked for a trailing serves note',
		() => extractYieldFromTitle(`Soup${' '.repeat(RUN)}x`),
	],
	[
		'an ingredient line of spaces before text ending in a line separator',
		() => parseIngredient(lineOf('1', ' ', 'x\r)')),
	],
	[
		'ingredient lines of spaces after an amount and unit',
		() =>
			parseRecipeText(
				paste({ ingredients: pasteLines(lineOf('1 cup flour', ' ', 'x')) }),
			),
	],
	[
		'ingredient lines of spaces with no amount',
		() =>
			parseRecipeText(
				paste({ ingredients: pasteLines(lineOf('salt', ' ', 'x')) }),
			),
	],
	[
		'ingredient lines of spaces before a paren in the name',
		() =>
			parseRecipeText(
				paste({
					ingredients: pasteLines(lineOf('1 cup a', ' ', '(b) c\rx')),
				}),
			),
	],
	[
		'ingredient lines of tabs before a closing paren',
		() =>
			parseRecipeText(
				paste({ ingredients: pasteLines(lineOf('salt', '\t', 'x(a)\ry')) }),
			),
	],
	[
		'ingredient lines of spaces that hold "(approx." but not at the run',
		() =>
			parseRecipeText(
				paste({
					ingredients: pasteLines(lineOf('1 cup flour (approx.)', ' ', 'x')),
				}),
			),
	],
	[
		'ingredient lines of spaces that end in "taste" but not "to taste"',
		() =>
			parseRecipeText(
				paste({ ingredients: pasteLines(lineOf('salt', ' ', 'x taste')) }),
			),
	],
	[
		'JSON-LD ingredient lines of "["',
		() => jsonLd({ recipeIngredient: jsonLdLines(lineOf('1 cup ', '[', '')) }),
	],
	[
		'JSON-LD ingredient lines of "]("',
		() =>
			jsonLd({
				recipeIngredient: jsonLdLines(lineOf('1 cup ', '[a](', '')),
			}),
	],
	[
		'JSON-LD ingredient lines of ",("',
		() =>
			jsonLd({ recipeIngredient: jsonLdLines(lineOf('1 cup a', ',(', '')) }),
	],
	[
		'JSON-LD ingredient lines of "("',
		() =>
			jsonLd({ recipeIngredient: jsonLdLines(lineOf('1 cup a', '(', ')')) }),
	],
	[
		'JSON-LD text that is one long run of "<"',
		() => cleanJsonLdText('<'.repeat(RUN)),
	],
	[
		'JSON-LD with far more ingredient lines than a Recipe holds',
		() => jsonLd({ recipeIngredient: manyLines }),
	],
	[
		'an amount far longer than any saved amount',
		() => {
			const amount = `1${' '.repeat(RUN)}x`
			scaleAmount(amount, 2, 'g')
			scaleAmountKitchen(amount, 2, 'g')
		},
	],
]

describe('parsing stays fast on long input', () => {
	test.each(cases)('%s', (_name, run) => {
		// Warm up so the first call's compile time isn't counted.
		parseRecipeText(paste({}))
		jsonLd({ recipeIngredient: ['1 cup flour'] })
		expect(elapsedMs(run)).toBeLessThan(BOUND_MS)
	})
})

describe('the line cap', () => {
	const fields =
		MAX_INGREDIENT_NAME_LENGTH +
		MAX_INGREDIENT_AMOUNT_LENGTH +
		MAX_INGREDIENT_UNIT_LENGTH +
		MAX_INGREDIENT_NOTES_LENGTH

	test('a line longer than the cap keeps more than the fields hold', () => {
		const words = Array.from({ length: 2000 }, (_, i) => `word${i}`)
		const parsed = parseIngredient(`2 cups flour, ${words.join(' ')}`)!
		expect(parsed).toMatchObject({ amount: '2', unit: 'cups', name: 'flour' })
		const kept = parsed.name.length + (parsed.notes?.length ?? 0)
		expect(kept).toBeGreaterThan(fields)
		expect(kept).toBeLessThanOrEqual(MAX_INGREDIENT_LINE_LENGTH)
	})

	test('import still reports a line past the cap as shortened', () => {
		const words = Array.from({ length: 2000 }, (_, i) => `word${i}`)
		const extracted = jsonLd({
			recipeIngredient: [`2 cups flour, ${words.join(' ')}`],
		})
		expect(fitImportedRecipe(extracted).shortened).toContain('ingredients')
	})

	test('a title past the save limit keeps its trailing serves note', () => {
		const title = `${'Slow-cooked '.repeat(20)}beans (Serves 6)`
		expect(extractYieldFromTitle(title)).toEqual({
			title: title.replace(' (Serves 6)', ''),
			yieldAmount: 6,
			yieldLabel: 'servings',
		})
	})

	test('JSON-LD past the ingredient limit still reports Ingredients shortened', () => {
		const extracted = jsonLd({
			recipeIngredient: Array.from(
				{ length: MAX_RECIPE_INGREDIENTS + 50 },
				(_, i) => `${i + 1} g flour`,
			),
		})
		const { recipe, shortened } = fitImportedRecipe(extracted)
		expect(shortened).toContain('ingredients')
		expect(recipe.ingredients).toHaveLength(MAX_RECIPE_INGREDIENTS)
		expect(recipe.ingredients.at(-1)).toMatchObject({
			amount: String(MAX_RECIPE_INGREDIENTS),
		})
	})
})
