/**
 * A scaled Recipe line or yield says "2 eggs", "2 pinches salt" and "Makes 2
 * loaves" instead of keeping the 1× wording ("2 egg", "2 pinch", "2 loaf").
 *
 * Failure list:
 * - A measured mass noun gets an s: "4 tbsp salts", "380 g plain flours".
 * - An abbreviated unit changes: "4 tbsps", "300 gs", "2 mls".
 * - A line with a count unit and a noun changes the noun as well as the unit:
 *   "2 pinches salts", or "2 cloves garlics".
 * - A count noun with no unit stays singular at 2× ("2 egg"), or stays plural
 *   when it scales down to one ("1 ripe bananas").
 * - An irregular plural comes out as "loafs", "leafs", "tomatos", "chillis".
 * - A line that is already plural gets a second s ("4 eggss").
 * - Half a lime reads "½ limes", or one and a half reads "1½ lime".
 * - A range ("1–2 eggs") is singularised from its low end, or crashes the
 *   count because it doesn't parse as one number.
 * - An unknown or non-English word is guessed at ("2 fetas", "4 huevoss").
 * - The note after a comma or in brackets is changed instead of the noun
 *   before it ("lime, cut into wedgess"), or the noun is missed because of it.
 * - At 1× the author's own wording changes, even a slip like "1 eggs".
 * - Capitals are lost ("Egg" turns into "eggs").
 * - An amount that isn't a number ("a few") throws or is read as one.
 * - A yield label isn't inflected the same way, or "slices of cake" turns into
 *   "slices of cakes".
 * - A container written into the name ("2 tins chopped tomatoes", which the
 *   parser leaves without a unit) is passed over and the noun after it
 *   changes instead ("1 tins chopped tomato").
 * - An amount kitchen rounding shows as a whole number (3 eggs at 0.34× shows
 *   "1") is counted from the unrounded value ("1 eggs").
 * - A container after a size or a word ("1 400g tin chopped tomatoes", "1
 *   large tin chopped tomatoes") is passed over and the noun after it changes
 *   ("1/2 400g tin chopped tomato").
 * - A line that names two things ("2 eggs or 1 flax egg", "1 apple or pear",
 *   "salt and pepper") or counts in dozens ("2 dozen eggs") changes one word
 *   of it ("1 flax eggs", "2 apple or pears", "1 dozen egg").
 * - The end of a hyphenated word is read as a word ("half-and-halves").
 * - "drop scone" or "pound cake" is read as a count of drops or pounds.
 * - A yield that kitchen rounding shows as 1 reads "Makes 1 loaves".
 * - "2 egg whites" at ½ reads "1 egg whites".
 */
import { expect, test } from 'vitest'
import { scaledLineWords, scaledYieldLabel } from './ingredient-plural.ts'

function line(amount: string | null, unit: string | null, name: string) {
	return { amount, unit, name }
}

test('a measured mass noun keeps its name', () => {
	expect(scaledLineWords(line('2', 'tbsp', 'salt'), 2)).toEqual({
		unit: 'tbsp',
		name: 'salt',
	})
	expect(scaledLineWords(line('190', 'g', 'plain flour'), 2)).toEqual({
		unit: 'g',
		name: 'plain flour',
	})
})

test('abbreviated units never change', () => {
	for (const unit of ['g', 'kg', 'ml', 'l', 'tbsp', 'tsp', 'oz', 'lb']) {
		expect(scaledLineWords(line('1', unit, 'water'), 3).unit).toBe(unit)
	}
})

test('a count unit changes and the noun after it stays', () => {
	expect(scaledLineWords(line('1', 'pinch', 'salt'), 2)).toEqual({
		unit: 'pinches',
		name: 'salt',
	})
	expect(scaledLineWords(line('2', 'cloves', 'garlic'), 0.5)).toEqual({
		unit: 'clove',
		name: 'garlic',
	})
	expect(scaledLineWords(line('1', 'can', 'chickpeas'), 2)).toEqual({
		unit: 'cans',
		name: 'chickpeas',
	})
})

test('a count noun with no unit follows the scaled amount', () => {
	expect(scaledLineWords(line('1', null, 'egg'), 2).name).toBe('eggs')
	expect(scaledLineWords(line('3', null, 'ripe bananas'), 1 / 3).name).toBe(
		'ripe banana',
	)
})

test('irregular plurals come out right both ways', () => {
	expect(scaledLineWords(line('1', null, 'loaf'), 2).name).toBe('loaves')
	expect(scaledLineWords(line('1', null, 'bay leaf'), 2).name).toBe(
		'bay leaves',
	)
	expect(scaledLineWords(line('1', null, 'tomato'), 2).name).toBe('tomatoes')
	expect(scaledLineWords(line('1', null, 'potato'), 3).name).toBe('potatoes')
	expect(scaledLineWords(line('1', null, 'red chilli'), 2).name).toBe(
		'red chillies',
	)
	expect(scaledLineWords(line('2', null, 'loaves'), 0.5).name).toBe('loaf')
	expect(scaledLineWords(line('4', null, 'tomatoes'), 0.25).name).toBe('tomato')
})

test('a line already plural stays plural', () => {
	expect(scaledLineWords(line('2', null, 'eggs'), 2).name).toBe('eggs')
	expect(scaledLineWords(line('2', 'cloves', 'garlic'), 2).unit).toBe('cloves')
})

test('a fraction of one is singular and anything over one is plural', () => {
	expect(scaledLineWords(line('1', null, 'lime'), 0.5).name).toBe('lime')
	expect(scaledLineWords(line('2', null, 'limes'), 0.5).name).toBe('lime')
	expect(scaledLineWords(line('1', null, 'lime'), 1.5).name).toBe('limes')
	expect(scaledLineWords(line('½', null, 'lemon'), 2).name).toBe('lemon')
})

test('a range counts by its high end', () => {
	expect(scaledLineWords(line('1–2', null, 'egg'), 2).name).toBe('eggs')
	// 1–1½ eggs: the low end alone would say "egg".
	expect(scaledLineWords(line('2-3', null, 'eggs'), 0.5).name).toBe('eggs')
})

test('an unknown or non-English word is left as written', () => {
	expect(scaledLineWords(line('1', null, 'feta'), 2).name).toBe('feta')
	expect(scaledLineWords(line('2', null, 'huevos'), 2).name).toBe('huevos')
	expect(scaledLineWords(line('1', null, 'jalapeño'), 2).name).toBe('jalapeño')
	expect(scaledLineWords(line('1', 'knob', 'butter'), 2).unit).toBe('knobs')
	expect(scaledLineWords(line('1', 'glug', 'olive oil'), 2).unit).toBe('glug')
})

test('the noun before a comma or bracket changes and the note stays', () => {
	expect(
		scaledLineWords(line('1', null, 'lime, cut into wedges'), 2).name,
	).toBe('limes, cut into wedges')
	expect(scaledLineWords(line('1', null, 'egg (beaten)'), 2).name).toBe(
		'eggs (beaten)',
	)
	expect(
		scaledLineWords(line('1', null, 'onion, sliced into rings'), 2).name,
	).toBe('onions, sliced into rings')
})

test('at 1× the line is exactly as the author wrote it', () => {
	expect(scaledLineWords(line('1', null, 'eggs'), 1)).toEqual({
		unit: null,
		name: 'eggs',
	})
	expect(scaledLineWords(line('2', 'pinch', 'salt'), 1)).toEqual({
		unit: 'pinch',
		name: 'salt',
	})
})

test('capitals are kept', () => {
	expect(scaledLineWords(line('1', null, 'Egg'), 2).name).toBe('Eggs')
	expect(scaledLineWords(line('1', 'Pinch', 'salt'), 2).unit).toBe('Pinches')
})

test('an amount that is not a number leaves the line alone', () => {
	expect(scaledLineWords(line('a few', null, 'egg'), 2).name).toBe('egg')
	expect(scaledLineWords(line(null, null, 'egg'), 2).name).toBe('egg')
})

test('a yield label follows the scaled yield', () => {
	expect(scaledYieldLabel('loaf', 2, 2)).toBe('loaves')
	expect(scaledYieldLabel('servings', 1, 0.25)).toBe('serving')
	expect(scaledYieldLabel('serving', 2, 2)).toBe('servings')
	expect(scaledYieldLabel('slice of cake', 8, 8)).toBe('slices of cake')
	expect(scaledYieldLabel('portions', 4, 1)).toBe('portions')
	expect(scaledYieldLabel('loaf', 1, 1)).toBe('loaf')
	expect(scaledYieldLabel('cup', 2, 2)).toBe('cups')
})

test('a container at the start of the name is what gets counted', () => {
	expect(
		scaledLineWords(line('2', null, 'tins chopped tomatoes'), 0.5).name,
	).toBe('tin chopped tomatoes')
	expect(scaledLineWords(line('1', null, 'pack tortillas'), 2).name).toBe(
		'packs tortillas',
	)
	expect(
		scaledLineWords(line('1', null, 'punnet cherry tomatoes'), 0.5).name,
	).toBe('punnet cherry tomatoes')
})

test('an amount that shows as a whole number counts as that number', () => {
	expect(scaledLineWords(line('3', null, 'eggs'), 0.34).name).toBe('egg')
	expect(scaledLineWords(line('3', null, 'peppers'), 0.32).name).toBe('pepper')
	expect(scaledLineWords(line('1', null, 'egg'), 1.1).name).toBe('eggs')
})

test('a container after a size or a word is what gets counted', () => {
	expect(
		scaledLineWords(line('1', null, '400g tin chopped tomatoes'), 0.5).name,
	).toBe('400g tin chopped tomatoes')
	expect(
		scaledLineWords(line('1', null, '400g tin chopped tomatoes'), 2).name,
	).toBe('400g tins chopped tomatoes')
	expect(
		scaledLineWords(line('1', null, 'large tin chopped tomatoes'), 2).name,
	).toBe('large tins chopped tomatoes')
})

test('a line naming two things, or counting in dozens, is left as written', () => {
	expect(scaledLineWords(line('2', null, 'eggs or 1 flax egg'), 2).name).toBe(
		'eggs or 1 flax egg',
	)
	expect(scaledLineWords(line('1', null, 'apple or pear'), 2).name).toBe(
		'apple or pear',
	)
	expect(scaledLineWords(line('1', null, 'egg and 1 yolk'), 2).name).toBe(
		'egg and 1 yolk',
	)
	expect(scaledLineWords(line('2', null, 'dozen eggs'), 0.5).name).toBe(
		'dozen eggs',
	)
	expect(scaledYieldLabel('dozen cookies', 0.5, 0.5)).toBe('dozen cookies')
})

test('a hyphenated word is left whole', () => {
	expect(scaledLineWords(line('1', null, 'half-and-half'), 2).name).toBe(
		'half-and-half',
	)
	expect(
		scaledLineWords(line('1', null, 'bone-in chicken thigh'), 2).name,
	).toBe('bone-in chicken thighs')
})

test('drop scones and pound cake count the scones and the cakes', () => {
	expect(scaledLineWords(line('1', null, 'drop scone'), 2).name).toBe(
		'drop scone',
	)
	expect(scaledLineWords(line('1', null, 'pound cake'), 2).name).toBe(
		'pound cakes',
	)
	expect(scaledLineWords(line('1', 'pound', 'beef mince'), 2).unit).toBe(
		'pounds',
	)
})

test('a yield that shows as a whole number counts as that number', () => {
	expect(scaledYieldLabel('loaf', 1.0025, 4.01)).toBe('loaf')
})

test('egg whites count the whites', () => {
	expect(scaledLineWords(line('2', null, 'egg whites'), 0.5).name).toBe(
		'egg white',
	)
	expect(scaledLineWords(line('1', null, 'egg white'), 3).name).toBe(
		'egg whites',
	)
})
