import { expect, test } from 'vitest'
import { fitImportedRecipe } from './import-recipe-fit.ts'
import { type ExtractedRecipe } from './import-recipe-types.ts'

function extracted(overrides: Partial<ExtractedRecipe> = {}): ExtractedRecipe {
	return {
		title: 'Chickpea lunch',
		description: null,
		notes: null,
		activeTime: null,
		totalTime: null,
		yieldAmount: null,
		yieldLabel: null,
		sourceUrl: '',
		metadataValueIds: [],
		rawText: 'Chickpea lunch',
		ingredients: [{ name: 'chickpeas', amount: '2', unit: 'cans' }],
		instructions: [{ content: 'Toss with lemon.' }],
		...overrides,
	}
}

function words(length: number) {
	return 'lemon '.repeat(Math.ceil(length / 6)).slice(0, length)
}

test('a blank title becomes Untitled Recipe', () => {
	expect(fitImportedRecipe(extracted({ title: '   ' })).recipe.title).toBe(
		'Untitled Recipe',
	)
})

test('a title over 100 characters is cut at a word, marked, and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ title: words(140) }),
	)
	expect(recipe.title.length).toBeLessThanOrEqual(100)
	expect(recipe.title).toMatch(/^(lemon )+lemon…$/)
	expect(shortened).toEqual(['title'])
})

test('a cut never leaves half of an emoji behind', () => {
	const { recipe } = fitImportedRecipe(
		extracted({ title: 'x'.repeat(98) + '😀😀' }),
	)
	expect(recipe.title).toBe('x'.repeat(98) + '…')
})

test('a description over 500 characters moves whole into Notes ahead of the notes, and nothing is reported', () => {
	const description = words(800)
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ description, notes: 'Keeps three days.' }),
	)
	expect(recipe.description).toBeNull()
	expect(recipe.notes).toBe(`${description.trim()}\n\nKeeps three days.`)
	expect(shortened).toEqual([])
})

test('a description too long for Notes as well is cut and reported, and the notes stay', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ description: words(1900), notes: words(500) }),
	)
	expect(recipe.description!.length).toBeLessThanOrEqual(500)
	expect(recipe.description).toMatch(/…$/)
	expect(recipe.notes).toBe(words(500).trim())
	expect(shortened).toEqual(['description'])
})

test('notes over 2000 characters are cut and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ notes: words(2600) }),
	)
	expect(recipe.notes!.length).toBeLessThanOrEqual(2000)
	expect(recipe.notes).toMatch(/…$/)
	expect(shortened).toEqual(['notes'])
})

test("an ingredient name over 200 characters continues in that ingredient's notes, ahead of them", () => {
	const name = `chickpeas ${words(250)}`
	const { recipe, shortened } = fitImportedRecipe(
		extracted({
			ingredients: [{ name, amount: '2', notes: 'rinsed' }],
		}),
	)
	const [ingredient] = recipe.ingredients
	expect(ingredient!.name.length).toBeLessThanOrEqual(200)
	expect(name.startsWith(ingredient!.name)).toBe(true)
	expect(`${ingredient!.name} ${ingredient!.notes}`).toBe(
		`${name.trim()}, rinsed`,
	)
	expect(shortened).toEqual([])
})

test('an ingredient name too long for its notes as well is cut and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ ingredients: [{ name: words(900), notes: 'rinsed' }] }),
	)
	expect(recipe.ingredients[0]!.name.length).toBeLessThanOrEqual(200)
	expect(recipe.ingredients[0]!.name).toMatch(/…$/)
	expect(recipe.ingredients[0]!.notes).toBe('rinsed')
	expect(shortened).toEqual(['ingredients'])
})

test('an over-long amount, unit or ingredient note is cut and reported once', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({
			ingredients: [
				{ name: 'flour', amount: words(80), unit: words(70) },
				{ name: 'salt', notes: words(700) },
			],
		}),
	)
	expect(recipe.ingredients[0]!.amount!.length).toBeLessThanOrEqual(50)
	expect(recipe.ingredients[0]!.unit!.length).toBeLessThanOrEqual(50)
	expect(recipe.ingredients[1]!.notes!.length).toBeLessThanOrEqual(500)
	expect(shortened).toEqual(['ingredients'])
})

test('rows past 200 ingredients or 200 instructions are left out and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({
			ingredients: Array.from({ length: 205 }, (_, i) => ({
				name: `item ${i}`,
			})),
			instructions: Array.from({ length: 201 }, (_, i) => ({
				content: `Step ${i}`,
			})),
		}),
	)
	expect(recipe.ingredients).toHaveLength(200)
	expect(recipe.ingredients.at(-1)!.name).toBe('item 199')
	expect(recipe.instructions).toHaveLength(200)
	expect(shortened).toEqual(['ingredients', 'instructions'])
})

test('a step over 5000 characters is cut and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ instructions: [{ content: words(6000) }] }),
	)
	expect(recipe.instructions[0]!.content.length).toBeLessThanOrEqual(5000)
	expect(shortened).toEqual(['instructions'])
})

test('blank ingredients and steps are dropped, and a heading keeps only its name', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({
			ingredients: [
				{ name: '  ', amount: '2' },
				{ name: 'For the dressing', isHeading: true, amount: '1', unit: 'x' },
				{ name: 'lemon', amount: ' ', unit: '', notes: '  ' },
			],
			instructions: [{ content: ' ' }, { content: ' Squeeze. ' }],
		}),
	)
	expect(recipe.ingredients).toEqual([
		{
			name: 'For the dressing',
			amount: null,
			unit: null,
			notes: null,
			isHeading: true,
		},
		{ name: 'lemon', amount: null, unit: null, notes: null, isHeading: false },
	])
	expect(recipe.instructions).toEqual([{ content: 'Squeeze.' }])
	expect(shortened).toEqual([])
})

test('a Recipe with no ingredients or no steps still fits', () => {
	const { recipe } = fitImportedRecipe(
		extracted({ ingredients: [], instructions: [] }),
	)
	expect(recipe.ingredients).toEqual([])
	expect(recipe.instructions).toEqual([])
})

test('times that are not positive whole minutes are rounded or dropped', () => {
	for (const [input, output] of [
		[0, null],
		[-5, null],
		[Number.NaN, null],
		[0.2, null],
		[7.4, 7],
		[45, 45],
	] as const) {
		const { recipe } = fitImportedRecipe(
			extracted({ activeTime: input, totalTime: input }),
		)
		expect(recipe.activeTime).toBe(output)
		expect(recipe.totalTime).toBe(output)
	}
})

test('a yield needs both a positive amount and a label', () => {
	const fit = (yieldAmount: number | null, yieldLabel: string | null) => {
		const { recipe } = fitImportedRecipe(extracted({ yieldAmount, yieldLabel }))
		return [recipe.yieldAmount, recipe.yieldLabel]
	}
	expect(fit(4, 'bowls')).toEqual([4, 'bowls'])
	expect(fit(4, null)).toEqual([4, 'servings'])
	expect(fit(4, '  ')).toEqual([4, 'servings'])
	expect(fit(null, 'bowls')).toEqual([null, null])
	expect(fit(0, 'bowls')).toEqual([null, null])
	expect(fit(-1, 'bowls')).toEqual([null, null])
	expect(fit(Number.NaN, 'bowls')).toEqual([null, null])
})

test('a yield label over 100 characters is cut and reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ yieldAmount: 2, yieldLabel: words(130) }),
	)
	expect(recipe.yieldLabel!.length).toBeLessThanOrEqual(100)
	expect(shortened).toEqual(['yield'])
})

test('a source URL that is not a public web address is dropped', () => {
	for (const sourceUrl of [
		'javascript:alert(1)',
		'ftp://example.com/recipe',
		'not a url',
		`https://example.com/${'a'.repeat(2000)}`,
		'',
	]) {
		expect(fitImportedRecipe(extracted({ sourceUrl })).recipe.sourceUrl).toBe(
			null,
		)
	}
	expect(
		fitImportedRecipe(extracted({ sourceUrl: 'https://example.com/pho' }))
			.recipe.sourceUrl,
	).toBe('https://example.com/pho')
})

test('source text over 50,000 characters is cut without being reported', () => {
	const { recipe, shortened } = fitImportedRecipe(
		extracted({ rawText: 'x'.repeat(60_000) }),
	)
	expect(recipe.rawText).toHaveLength(50_000)
	expect(shortened).toEqual([])
})

test('a classification suggested twice is kept once', () => {
	expect(
		fitImportedRecipe(extracted({ metadataValueIds: ['a', 'b', 'a'] })).recipe
			.metadataValueIds,
	).toEqual(['a', 'b'])
})

test('blank optional text becomes null and the rest is trimmed', () => {
	const { recipe } = fitImportedRecipe(
		extracted({
			title: '  Pho  ',
			description: '   ',
			notes: '\n',
		}),
	)
	expect(recipe).toMatchObject({ title: 'Pho', description: null, notes: null })
})
