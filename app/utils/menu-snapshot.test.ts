import { describe, expect, test } from 'vitest'
import {
	groupSnapshotEntries,
	menuToSnapshotSections,
	snapshotHasContent,
	type MenuForSnapshot,
} from './menu-snapshot.ts'

const HOUSEHOLD = 'hh-1'

function recipeItem(
	overrides: Partial<MenuForSnapshot['sections'][number]['items'][number]> = {},
): MenuForSnapshot['sections'][number]['items'][number] {
	return {
		kind: 'recipe',
		recipeTitle: 'Frozen Title',
		scaleMultiplier: 1,
		note: null,
		recipe: { id: 'r1', title: 'Live Title', householdId: HOUSEHOLD },
		shoppingLines: [],
		...overrides,
	}
}

function noteItem(
	text: string | null,
	shoppingLines: MenuForSnapshot['sections'][number]['items'][number]['shoppingLines'] = [],
): MenuForSnapshot['sections'][number]['items'][number] {
	return {
		kind: 'note',
		recipeTitle: null,
		scaleMultiplier: null,
		note: text,
		recipe: null,
		shoppingLines,
	}
}

describe('menuToSnapshotSections', () => {
	test('copies section order, names, and interleaved card order verbatim', () => {
		const sections = menuToSnapshotSections(
			{
				sections: [
					{ name: null, items: [recipeItem()] },
					{
						name: 'Mains',
						items: [
							recipeItem({
								recipe: { id: 'r2', title: 'Stew', householdId: HOUSEHOLD },
							}),
							noteItem('Serve warm'),
							recipeItem({
								recipe: { id: 'r3', title: 'Rice', householdId: HOUSEHOLD },
							}),
						],
					},
				],
			},
			HOUSEHOLD,
		)
		expect(sections.map((section) => section.name)).toEqual([null, 'Mains'])
		expect(
			sections[1]!.items.map((item) =>
				item.kind === 'recipe' ? item.recipeId : item.text,
			),
		).toEqual(['r2', 'Serve warm', 'r3'])
	})

	test('freezes the displayed identity: live Recipe title when resolvable, frozen card title otherwise', () => {
		const sections = menuToSnapshotSections(
			{
				sections: [
					{
						name: null,
						items: [
							recipeItem(), // live wins
							recipeItem({ recipe: null, recipeTitle: 'Deleted Dish' }),
						],
					},
				],
			},
			HOUSEHOLD,
		)
		const [live, missing] = sections[0]!.items
		expect(live).toMatchObject({
			kind: 'recipe',
			recipeId: 'r1',
			recipeTitle: 'Live Title',
		})
		expect(missing).toMatchObject({
			kind: 'recipe',
			recipeId: null,
			recipeTitle: 'Deleted Dish',
		})
	})

	test('a reference outside the household freezes as a missing card', () => {
		const sections = menuToSnapshotSections(
			{
				sections: [
					{
						name: null,
						items: [
							recipeItem({
								recipeTitle: 'Foreign Dish',
								recipe: { id: 'rx', title: 'Other', householdId: 'other-hh' },
							}),
						],
					},
				],
			},
			HOUSEHOLD,
		)
		expect(sections[0]!.items[0]).toMatchObject({
			kind: 'recipe',
			recipeId: null,
			recipeTitle: 'Foreign Dish',
		})
	})

	test('copies multipliers unchanged, defaults an absent one to 1×, and keeps display notes', () => {
		const sections = menuToSnapshotSections(
			{
				sections: [
					{
						name: null,
						items: [
							recipeItem({ scaleMultiplier: 2.5, note: 'double batch' }),
							recipeItem({ scaleMultiplier: null }),
						],
					},
				],
			},
			HOUSEHOLD,
		)
		expect(
			sections[0]!.items.map((item) =>
				item.kind === 'recipe' ? [item.scaleMultiplier, item.note] : null,
			),
		).toEqual([
			[2.5, 'double batch'],
			[1, null],
		])
	})

	test('copies note Shopping lines and drops unrepresentable cards', () => {
		const sections = menuToSnapshotSections(
			{
				sections: [
					{
						name: 'Drinks',
						items: [
							noteItem('Get drinks', [
								{ name: 'Lemonade', quantity: '2', unit: 'l' },
								{ name: 'Ice', quantity: null, unit: null },
							]),
							noteItem('   '), // no text — dropped
							recipeItem({ recipe: null, recipeTitle: null }), // no identity — dropped
						],
					},
				],
			},
			HOUSEHOLD,
		)
		expect(sections[0]!.items).toEqual([
			{
				kind: 'note',
				text: 'Get drinks',
				shoppingLines: [
					{ name: 'Lemonade', quantity: '2', unit: 'l' },
					{ name: 'Ice', quantity: null, unit: null },
				],
			},
		])
	})

	test('snapshotHasContent is false only when every section is empty', () => {
		expect(snapshotHasContent([])).toBe(false)
		expect(snapshotHasContent([{ name: 'Empty', items: [] }])).toBe(false)
		expect(
			snapshotHasContent([
				{ name: null, items: [] },
				{
					name: 'Drinks',
					items: [{ kind: 'note', text: 'x', shoppingLines: [] }],
				},
			]),
		).toBe(true)
	})
})

describe('groupSnapshotEntries', () => {
	test('interleaves recipe and note rows by their shared per-section order', () => {
		const groups = groupSnapshotEntries(
			[
				{ id: 's1', name: 'Mains' },
				{ id: 's2', name: null },
			],
			[
				{ sectionId: 's1', order: 2, label: 'r-late' },
				{ sectionId: 's2', order: 0, label: 'r-other' },
				{ sectionId: 's1', order: 0, label: 'r-first' },
				{ sectionId: null, order: 0, label: 'r-unsectioned' },
			],
			[{ sectionId: 's1', order: 1, label: 'n-middle' }],
		)
		expect(
			groups.map((group) => [
				group.name,
				group.entries.map((entry) => entry.item.label),
			]),
		).toEqual([
			['Mains', ['r-first', 'n-middle', 'r-late']],
			[null, ['r-other']],
		])
	})
})
