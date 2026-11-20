/**
 * Parsing time on long input. Recipe import reads pages up to 5 MB and a
 * paste up to MAX_RAW_TEXT_LENGTH, so the patterns that read that text must
 * stay linear in its length. Each case times the same input at one size and
 * at sixteen times that size (tests/growth.ts): linear work takes about 16
 * times as long, while quadratic work takes about 256 times. The ratio holds
 * on a slow or busy runner or under coverage, where a fixed time limit would
 * not.
 *
 * Ingredient lines are cut at MAX_INGREDIENT_LINE_LENGTH, so the cases that
 * check patterns inside one ingredient line grow the line below that cap.
 *
 * Failure list:
 * - A paste line that starts with a section word and then runs on in spaces
 *   ("Ingredients      …x").
 * - A paste whose title line ends in a long run of spaces before other text.
 * - A paste description line "Serves      …x", "Serves 4 a      …x" or
 *   "Serves 4 a::::…x".
 * - A paste of "++[" over and over.
 * - A paste step that is one long run of digits, or of "1.", before a step
 *   that starts with a unit.
 * - Saved steps of digits, or of a number then spaces, shown with Metric on,
 *   which rewrites Fahrenheit in every step on each render.
 * - Ingredient lines with a run of spaces after the amount, unit or
 *   parenthetical that each pattern reads, before text that ends in a line
 *   separator once a stray ")" is dropped ("1      x\r)"). That reaches the
 *   name-and-notes part of the amount, mixed fraction, fluid ounce, can size,
 *   pack size and "juice of" patterns. The leading and embedded paren
 *   patterns read a name those have already matched, which holds no line
 *   separator, so the same part of theirs can't backtrack and has no case.
 * - Ingredient lines that start with a long run of thousands split by
 *   spaces, or with "1 000" and then a run of spaces, before a line
 *   separator.
 * - Ingredient lines with a run of spaces in the name before a paren.
 * - Ingredient lines with runs of spaces before text that never ends in
 *   "(…)", "(approx.)" or "to taste", including lines that hold "(approx."
 *   or end in "taste" somewhere else, or put a paren after the run.
 * - JSON-LD ingredient lines made of "[", "[a](", ",(" or "(".
 * - JSON-LD text that is one long run of "<".
 * - JSON-LD with far more ingredient lines than a Recipe holds: the work
 *   stays the same however many lines follow.
 * - An amount string far longer than any saved amount: the work stays the
 *   same however long it is.
 * - A line longer than the cap: the parse says it was cut, and import reports
 *   Ingredients as shortened. Link markup doesn't count towards the cap.
 * - A title longer than the save limit still gives up a trailing
 *   "(Serves 2)".
 * - JSON-LD with more ingredient rows than a Recipe holds reports Ingredients
 *   as shortened, counting rows the save keeps rather than lines.
 */
import { describe, expect, test } from 'vitest'
import {
	BACKSTOP_MS,
	MAX_GROWTH,
	SPREAD,
	bestMs,
	growth,
} from '#tests/growth.ts'
import { scaleAmount, scaleAmountKitchen } from './fractions.ts'
import { fitImportedRecipe } from './import-recipe-fit.ts'
import { type ExtractedRecipe } from './import-recipe-types.ts'
import {
	MAX_INGREDIENT_LINE_LENGTH,
	parseIngredient,
} from './ingredient-parser.ts'
import { convertTemperatures } from './metric-conversion.ts'
import { cleanJsonLdText, extractRecipe } from './recipe-jsonld.server.ts'
import {
	extractYieldFromTitle,
	joinBrokenUnitSteps,
	parseRecipeText,
} from './recipe-text-parser.ts'
import {
	MAX_INSTRUCTION_LENGTH,
	MAX_RAW_TEXT_LENGTH,
	MAX_RECIPE_INGREDIENTS,
} from './recipe-validation.ts'

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

// A sixteenth of a paste, so the larger size is a whole one.
const RUN = Math.floor((MAX_RAW_TEXT_LENGTH - 100) / SPREAD)
// A twentieth of the line cap, so the larger size still fits under it.
const LINE_RUN = Math.floor(MAX_INGREDIENT_LINE_LENGTH / (SPREAD * 1.25))

const jsonLd = (fields: Record<string, unknown>) =>
	extractRecipe(
		{ '@type': 'Recipe', name: 'Soup', ...fields },
		'https://example.com/soup',
	)

// The cases that grow ingredient lines below the line cap start from a
// short line, so the work that doesn't depend on its length (one parse per
// line) is a large share of the small size. Linear code then grows only 4 to
// 10 times, and quadratic code about 150 times, so these cases fail at
// half the usual limit.
const LINE_MAX_GROWTH = MAX_GROWTH / 2
const lineCases = new WeakSet<(size: number) => () => unknown>()
function lineCase(build: (size: number) => () => unknown) {
	lineCases.add(build)
	return build
}

/** 50 paste ingredient lines, each with `fill` repeated to the size. */
const pasteLines = (head: string, fill: string, tail: string) =>
	lineCase((size: number) => {
		const line = `- ${head}${fill.repeat((LINE_RUN * size) / fill.length)}${tail}`
		const text = paste({ ingredients: Array(50).fill(line) })
		return () => parseRecipeText(text)
	})

/** One JSON-LD line past the ingredient limit, each grown to the size. */
const jsonLdLines = (head: string, fill: string, tail: string) =>
	lineCase((size: number) => {
		const line = `${head}${fill.repeat((LINE_RUN * size) / fill.length)}${tail}`
		const lines = Array(MAX_RECIPE_INGREDIENTS + 1).fill(line)
		return () => jsonLd({ recipeIngredient: lines })
	})

const pasteOf =
	(make: (run: string) => Parameters<typeof paste>[0]) =>
	(fill: string) =>
	(size: number) => {
		const text = paste(make(fill.repeat((RUN * size) / fill.length)))
		return () => parseRecipeText(text)
	}

type Case = [string, (size: number) => () => unknown, number?]

const cases: Case[] = [
	[
		'a section word followed by a long run of spaces',
		pasteOf((run) => ({ description: [`Ingredients${run}x`] }))(' '),
	],
	[
		'a title that ends in a long run of spaces before other text',
		pasteOf((run) => ({ title: `Soup${run}x` }))(' '),
	],
	[
		'a yield line with a long run of spaces after "Serves"',
		pasteOf((run) => ({ description: [`Serves${run}x`] }))(' '),
	],
	[
		'a yield line with a long run of spaces inside its label',
		pasteOf((run) => ({ description: [`Serves 4 a${run}x`] }))(' '),
	],
	[
		'a yield line whose label holds a long run of colons',
		pasteOf((run) => ({ description: [`Serves 4 a${run}x`] }))(':'),
	],
	[
		'an Apple Notes link opener repeated across the paste',
		(size) => {
			const text = '++['.repeat((RUN * size) / 3)
			return () => parseRecipeText(text)
		},
	],
	[
		'a step of digits before a step that starts with a unit',
		pasteOf((run) => ({ steps: [`1. ${run}x`, '2. F and serve'] }))('1'),
	],
	[
		'a step of "1." repeated before a step that starts with a unit',
		(size) => {
			const steps = [{ content: `${'1.'.repeat((RUN * size) / 2)}x` }]
			return () => joinBrokenUnitSteps([...steps, { content: 'F' }])
		},
	],
	[
		'a title of spaces checked for a trailing serves note',
		(size) => {
			const title = `Soup${' '.repeat(RUN * size)}x`
			return () => extractYieldFromTitle(title)
		},
	],
	[
		'saved steps of digits shown with Metric on',
		(size) => {
			const step = `${'1'.repeat((MAX_INSTRUCTION_LENGTH * size) / SPREAD)}x`
			return () => convertTemperatures(step)
		},
	],
	[
		'saved steps of spaces after a number shown with Metric on',
		(size) => {
			const step = `350${' '.repeat((MAX_INSTRUCTION_LENGTH * size) / SPREAD)}x`
			return () => convertTemperatures(step)
		},
	],
	...(
		[
			['an amount and unit', '1 cup'],
			['a bare amount', '1'],
			['a mixed fraction', '1 1/2'],
			['fluid ounces', '2 fl oz'],
			['a can size', '1 (14 oz) can'],
			['a pack size', '2 x 400 g'],
			['"juice of"', 'juice of 1'],
		] as const
	).map(([what, head]): Case => [
		`ingredient lines of spaces after ${what}, before a line separator`,
		pasteLines(head, ' ', 'x\r)'),
	]),
	[
		'ingredient lines of spaces after an amount and unit',
		pasteLines('1 cup flour', ' ', 'x'),
	],
	['ingredient lines of spaces with no amount', pasteLines('salt', ' ', 'x')],
	[
		'ingredient lines of thousands split by spaces, before a line separator',
		pasteLines('1', ' 000', ' g x\r)'),
	],
	[
		'ingredient lines of thousands split by spaces, then spaces',
		pasteLines('1 000', ' ', 'x\r)'),
	],
	[
		'ingredient lines of spaces in the name before a paren',
		pasteLines('1 cup a', ' ', 'x (b) c'),
	],
	[
		'ingredient lines of spaces before a paren in the name',
		pasteLines('1 cup a', ' ', '(b) c\rx'),
	],
	[
		'ingredient lines of tabs before a closing paren',
		pasteLines('salt', '\t', 'x(a)\ry'),
	],
	[
		'ingredient lines of spaces that hold "(approx." but not at the run',
		pasteLines('1 cup flour (approx.)', ' ', 'x'),
	],
	[
		'ingredient lines of spaces that end in "taste" but not "to taste"',
		pasteLines('salt', ' ', 'x taste'),
	],
	['JSON-LD ingredient lines of "["', jsonLdLines('1 cup ', '[', '')],
	['JSON-LD ingredient lines of "[a]("', jsonLdLines('1 cup ', '[a](', '')],
	['JSON-LD ingredient lines of ",("', jsonLdLines('1 cup a', ',(', '')],
	['JSON-LD ingredient lines of "("', jsonLdLines('1 cup a', '(', ')')],
	[
		'JSON-LD text that is one long run of "<"',
		(size) => {
			const text = '<'.repeat(RUN * size)
			return () => cleanJsonLdText(text)
		},
	],
	[
		'an amount far longer than any saved amount',
		(size) => {
			const amount = `1${' '.repeat(RUN * size)}x`
			return () => {
				scaleAmount(amount, 2, 'g')
				scaleAmountKitchen(amount, 2, 'g')
			}
		},
		// An amount that long is never read, so its length adds nothing.
		4,
	],
]

describe('parsing stays linear on long input', () => {
	test.each(cases)('%s', (_name, build, maxGrowth) => {
		const { ratio, largeMs } = growth(build)
		expect(ratio).toBeLessThan(
			maxGrowth ?? (lineCases.has(build) ? LINE_MAX_GROWTH : MAX_GROWTH),
		)
		expect(largeMs).toBeLessThan(BACKSTOP_MS)
	})

	test('JSON-LD with far more ingredient lines than a Recipe holds', () => {
		// Keeping the source as raw text reads every line once anyway, so the
		// import should cost about that much, not a parse of every line.
		const node = {
			'@type': 'Recipe',
			name: 'Soup',
			recipeIngredient: Array.from(
				{ length: 200_000 },
				(_, i) => `${i} g flour, (sifted)`,
			),
		}
		const keepRawText = () => JSON.stringify(node, null, 2)
		const extract = () => extractRecipe(node, 'https://example.com/soup')
		keepRawText()
		extract()
		expect(bestMs(extract, 1)).toBeLessThan(4 * bestMs(keepRawText, 1))
	})
})

describe('the line cap', () => {
	// Two links whose markup alone is over the cap, then notes that fit.
	const url = (c: string) => `https://example.com/${c.repeat(420)}`
	const linked = `2 cups [flour](${url('a')}) or [spelt](${url('b')}), sifted, plus extra for dusting the counter and your hands while you knead the dough until it is smooth and springy, about ten minutes by hand or five in a mixer`
	// A run of spaces pushes the end of the notes past the cap.
	const spaced = `2 cups flour, sifted${' '.repeat(990)}then chilled overnight`

	const fromPaste = (line: string): ExtractedRecipe => {
		const parsed = parseRecipeText(
			`Bread\nIngredients\n- ${line}\nInstructions\n1. Bake`,
		)
		return {
			title: parsed.title,
			description: null,
			notes: null,
			activeTime: null,
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
			sourceUrl: '',
			metadataValueIds: [],
			rawText: line,
			ingredients: parsed.ingredients,
			ingredientsCut: parsed.ingredientsCut,
			instructions: parsed.instructions,
		}
	}

	test('a line past the cap says it was cut', () => {
		expect(parseIngredient(spaced)).toMatchObject({
			amount: '2',
			unit: 'cups',
			name: 'flour',
			notes: 'sifted',
			cut: true,
		})
		expect(parseIngredient('2 cups flour, sifted')).not.toHaveProperty('cut')
	})

	test('a pasted line past the cap is reported as shortened', () => {
		const { shortened } = fitImportedRecipe(fromPaste(spaced))
		expect(shortened).toContain('ingredients')
	})

	test('a JSON-LD line past the cap is reported as shortened', () => {
		// JSON-LD text has its runs of spaces collapsed, so this line is long in
		// stray parens, which the parse drops once the line is cut.
		const parens = `2 cups flour, sifted ${'('.repeat(990)} then chilled overnight`
		const extracted = jsonLd({ recipeIngredient: [parens] })
		expect(extracted.ingredients[0]).toEqual({
			amount: '2',
			unit: 'cups',
			name: 'flour',
			notes: 'sifted',
		})
		expect(fitImportedRecipe(extracted).shortened).toContain('ingredients')
	})

	test('link markup does not count towards the cap', () => {
		expect(linked.length).toBeGreaterThan(MAX_INGREDIENT_LINE_LENGTH)
		for (const extracted of [
			fromPaste(linked),
			jsonLd({ recipeIngredient: [linked] }),
		]) {
			const { recipe, shortened } = fitImportedRecipe(extracted)
			expect(shortened).toEqual([])
			expect(recipe.ingredients[0]!.notes).toMatch(/five in a mixer$/)
		}
	})

	test('a title past the save limit keeps its trailing serves note', () => {
		const title = `${'Slow-cooked '.repeat(20)}beans (Serves 6)`
		expect(extractYieldFromTitle(title)).toEqual({
			title: title.replace(' (Serves 6)', ''),
			yieldAmount: 6,
			yieldLabel: 'servings',
		})
	})

	test('JSON-LD past the ingredient limit reports Ingredients shortened', () => {
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

	test('lines that make no row do not count towards the limit', () => {
		const rows = (count: number) =>
			Array.from({ length: count }, (_, i) => `${i + 1} g flour`)
		const over = fitImportedRecipe(
			jsonLd({ recipeIngredient: ['- [ ]', ...rows(230)] }),
		)
		expect(over.shortened).toContain('ingredients')
		expect(over.recipe.ingredients).toHaveLength(MAX_RECIPE_INGREDIENTS)

		const full = fitImportedRecipe(
			jsonLd({
				recipeIngredient: [
					'- [ ]',
					...rows(MAX_RECIPE_INGREDIENTS),
					'- [ ]',
					'',
				],
			}),
		)
		expect(full.shortened).toEqual([])
		expect(full.recipe.ingredients).toHaveLength(MAX_RECIPE_INGREDIENTS)
	})
})
