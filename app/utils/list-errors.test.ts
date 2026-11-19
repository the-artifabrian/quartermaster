import { expect, test } from 'vitest'
import { listErrors } from './list-errors.ts'

test("a row's field error lands on that row, under the field's name", () => {
	const { rows } = listErrors(
		{ 'ingredients[2].name': ['Name this ingredient, or remove it.'] },
		'ingredients',
	)
	expect(rows[2]).toEqual({ name: ['Name this ingredient, or remove it.'] })
	expect(rows[0]).toBeUndefined()
	expect(rows[1]).toBeUndefined()
})

test('rows past 9 keep their index', () => {
	const { rows } = listErrors(
		{ 'ingredients[12].amount': ['Amount is too long'] },
		'ingredients',
	)
	expect(rows[12]).toEqual({ amount: ['Amount is too long'] })
})

test("the list's own error is not a row error", () => {
	const result = listErrors(
		{ ingredients: ['Add at least one ingredient.'] },
		'ingredients',
	)
	expect(result.list).toEqual(['Add at least one ingredient.'])
	expect(result.rows).toEqual([])
})

test("another list's errors, or a name that only starts the same, are left out", () => {
	const result = listErrors(
		{
			'instructions[0].content': ['Write this step, or remove it.'],
			'ingredientsExtra[0].name': ['x'],
			title: ['Title is required'],
		},
		'ingredients',
	)
	expect(result).toEqual({ list: undefined, rows: [] })
})

test("an error on a whole row lands on the row under ''", () => {
	const { rows } = listErrors({ 'ingredients[1]': ['Bad row'] }, 'ingredients')
	expect(rows[1]).toEqual({ '': ['Bad row'] })
})

test('several fields of one row stay together', () => {
	const { rows } = listErrors(
		{
			'ingredients[0].name': ['a'],
			'ingredients[0].notes': ['b'],
		},
		'ingredients',
	)
	expect(rows[0]).toEqual({ name: ['a'], notes: ['b'] })
})

test('empty error lists are no errors', () => {
	const result = listErrors(
		{ ingredients: [], 'ingredients[0].name': [] },
		'ingredients',
	)
	expect(result).toEqual({ list: undefined, rows: [] })
})
