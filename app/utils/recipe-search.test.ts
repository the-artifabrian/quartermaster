import { expect, test } from 'vitest'
import {
	rankRecipeSearchMatches,
	rankRecipeTitleMatches,
} from './recipe-search.ts'

test('finds a Recipe title with one adjacent-transposition typo', () => {
	const recipes = [
		{ id: 'salad', title: 'Simple Green Salad' },
		{ id: 'curry', title: 'Chicken Curry' },
	]

	expect(rankRecipeTitleMatches(recipes, 'chikcen curry')).toEqual([recipes[1]])
})

test('finds a Recipe title with one missing character', () => {
	const recipe = { id: 'curry', title: 'Chicken Curry' }

	expect(rankRecipeTitleMatches([recipe], 'chcken curry')).toEqual([recipe])
})

test('finds an accented Recipe title with an unaccented query', () => {
	const recipes = [
		{ id: 'soup', title: 'Ciorbă' },
		{ id: 'stew', title: 'Tocăniță' },
	]

	expect(rankRecipeTitleMatches(recipes, 'ciorba')).toEqual([recipes[0]])
})

test('preserves case-insensitive non-adjacent title-word matching', () => {
	const recipe = { id: 'stew', title: 'Pea and Carrot Stew' }

	expect(rankRecipeTitleMatches([recipe], '  PEA   STEW  ')).toEqual([recipe])
})

test('ranks exact titles above partial titles and partial titles above fuzzy titles', () => {
	const recipes = [
		{ id: 'fuzzy', title: 'Chickne Curry' },
		{ id: 'partial', title: 'Weeknight Chicken Curry' },
		{ id: 'exact', title: 'Chicken Curry' },
	]

	expect(rankRecipeTitleMatches(recipes, 'chicken curry')).toEqual([
		recipes[2],
		recipes[1],
		recipes[0],
	])
})

test('does not fuzzy-match very short terms', () => {
	const recipes = [{ id: 'pie', title: 'Pie' }]

	expect(rankRecipeTitleMatches(recipes, 'ipe')).toEqual([])
})

test('does not fuzzy-match unrelated terms', () => {
	const recipes = [{ id: 'curry', title: 'Chicken Curry' }]

	expect(rankRecipeTitleMatches(recipes, 'lentil soup')).toEqual([])
})

test('caps pasted queries before matching', () => {
	const recipe = {
		id: 'eight-words',
		title: 'One Two Three Four Five Six Seven Eight',
	}

	expect(
		rankRecipeTitleMatches(
			[recipe],
			'one two three four five six seven eight ignored pasted words',
		),
	).toEqual([recipe])
})

test('keeps description and ingredient matches behind title matches', () => {
	const recipes = [
		{
			id: 'fields',
			title: 'Weeknight Curry',
			description: 'Quick dinner',
			ingredients: [{ name: 'chicken thighs' }],
		},
		{
			id: 'title',
			title: 'Quick Chicken Supper',
			description: null,
			ingredients: [],
		},
	]

	expect(rankRecipeSearchMatches(recipes, 'quick chicken')).toEqual([
		recipes[1],
		recipes[0],
	])
})
