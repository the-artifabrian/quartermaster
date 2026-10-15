import { expect, test } from 'vitest'
import { recipesLibraryRootAfter } from './recipes-library-root.ts'

const inside = { enteredFromOutside: false }
const outside = { enteredFromOutside: true }

test('the Menus list names its library', () => {
	expect(
		recipesLibraryRootAfter('/recipes', {
			pathname: '/recipes/menus',
			...inside,
		}),
	).toBe('/recipes/menus')
})

test('the Recipes list names its library after Menus', () => {
	expect(
		recipesLibraryRootAfter('/recipes/menus', {
			pathname: '/recipes',
			...inside,
		}),
	).toBe('/recipes')
})

test('a Menu page belongs to Menus even when opened from the Plan', () => {
	expect(
		recipesLibraryRootAfter('/recipes', {
			pathname: '/recipes/menus/m1',
			...outside,
		}),
	).toBe('/recipes/menus')
})

test('a Menu edit page belongs to Menus', () => {
	expect(
		recipesLibraryRootAfter('/recipes', {
			pathname: '/recipes/menus/m1/edit',
			...inside,
		}),
	).toBe('/recipes/menus')
})

test("a Menu's Recipe keeps Menus as its root", () => {
	expect(
		recipesLibraryRootAfter('/recipes/menus', {
			pathname: '/recipes/r1',
			...inside,
		}),
	).toBe('/recipes/menus')
})

test('a Recipe opened from outside the tab belongs to Recipes', () => {
	expect(
		recipesLibraryRootAfter('/recipes/menus', {
			pathname: '/recipes/r1',
			...outside,
		}),
	).toBe('/recipes')
})

test('the tab bar restoring a Recipe page keeps Menus', () => {
	// The restore is reported as entered from inside: the stack is the same.
	expect(
		recipesLibraryRootAfter('/recipes/menus', {
			pathname: '/recipes/r1',
			...inside,
		}),
	).toBe('/recipes/menus')
})

test('a page outside the tab leaves the root alone', () => {
	expect(
		recipesLibraryRootAfter('/recipes/menus', {
			pathname: '/shopping',
			...outside,
		}),
	).toBe('/recipes/menus')
})

test('a Recipe whose id starts with "menus" is not a Menu page', () => {
	expect(
		recipesLibraryRootAfter('/recipes', {
			pathname: '/recipes/menusabc',
			...inside,
		}),
	).toBe('/recipes')
})
