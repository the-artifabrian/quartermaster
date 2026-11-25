/**
 * The From Plan picker's line statuses and tick rules.
 */
import { expect, test } from 'vitest'
import {
	defaultPickedLines,
	mealPickState,
	planPickerLineStatus,
	toggleMealPicks,
	type PlanPickerLine,
} from './shopping-plan-picker.ts'

function line(
	canonicalName: string,
	status: PlanPickerLine['status'],
): PlanPickerLine {
	return {
		canonicalName,
		name: canonicalName,
		quantity: null,
		unit: null,
		status,
	}
}

const lines: PlanPickerLine[] = [
	line('chicken', 'needed'),
	line('salt', 'on-hand'),
	line('rice', 'name-on-list'),
	line('lemon', 'added'),
]

test('a line this Meal already put on Shopping is added, whatever else is true of it', () => {
	const status = (
		canonicalName: string,
		contribution?: { sameAmount: boolean; onLater?: boolean },
	) =>
		planPickerLineStatus({
			canonicalName,
			contribution: contribution && {
				onLater: false,
				...contribution,
			},
			listedIdentities: new Set(['lemon', 'rice']),
			keptByAvailability: new Set(['lemon', 'rice', 'chicken']),
			pantryStaple: canonicalName === 'salt',
		})
	const same = { sameAmount: true }
	expect(status('lemon', same)).toBe('added')
	// Its row could be the only row with the name, or a Staple's name.
	expect(status('salt', same)).toBe('added')
	// Scaled since: the Meal's old amount is what Shopping has.
	expect(status('lemon', { sameAmount: false })).toBe('changed')
	// On a Later row, ticking moves it to Next shop, changed amount or not.
	expect(status('lemon', { sameAmount: true, onLater: true })).toBe('later')
	expect(status('lemon', { sameAmount: false, onLater: true })).toBe('later')
	expect(status('salt', { sameAmount: false })).toBe('changed')
	expect(status('rice')).toBe('name-on-list')
	expect(status('salt')).toBe('on-hand')
	expect(status('chicken')).toBe('needed')
})

test('a line with a different amount on Shopping can’t be ticked and never makes a Meal done', () => {
	const changed = line('chicken', 'changed')
	expect(defaultPickedLines([changed])).toEqual([])
	expect(
		toggleMealPicks([changed, line('salt', 'on-hand')], new Set()),
	).toEqual(new Set(['salt']))
	// Nothing to tick, but not done either.
	expect(mealPickState([line('lemon', 'added'), changed], new Set())).toBe(
		'unpickable',
	)
	expect(mealPickState([changed], new Set())).toBe('unpickable')
	expect(
		mealPickState(
			[line('lemon', 'added'), changed, line('salt', 'on-hand')],
			new Set(),
		),
	).toBe('none')
})

test('only needed lines are ticked by default', () => {
	expect(defaultPickedLines(lines)).toEqual(['chicken'])
})

test('a Meal on a day already gone starts with nothing ticked', () => {
	expect(defaultPickedLines(lines, { past: true })).toEqual([])
})

test('the Meal box fills an empty Meal with its needed lines first', () => {
	expect([...toggleMealPicks(lines, new Set())]).toEqual(['chicken'])
})

test('the Meal box fills a part-ticked Meal, then empties a full one, and never ticks an added line', () => {
	const full = toggleMealPicks(lines, new Set(['chicken']))
	expect([...full]).toEqual(['chicken', 'salt', 'rice'])
	expect(mealPickState(lines, full)).toBe('all')
	expect(toggleMealPicks(lines, full).size).toBe(0)
})

test('the Meal box ticks every line it can when no line is needed', () => {
	const notNeeded = lines.filter((entry) => entry.status !== 'needed')
	expect([...toggleMealPicks(notNeeded, new Set())]).toEqual(['salt', 'rice'])
})

test('a Meal whose lines are all added is done, and its box ticks nothing', () => {
	const added = [line('lemon', 'added'), line('thyme', 'added')]
	expect(mealPickState(added, new Set())).toBe('done')
	expect(toggleMealPicks(added, new Set()).size).toBe(0)
	expect(defaultPickedLines(added)).toEqual([])
})

test('the Meal box state counts only lines that can be picked', () => {
	expect(mealPickState(lines, new Set())).toBe('none')
	expect(mealPickState(lines, new Set(['chicken']))).toBe('some')
	expect(mealPickState(lines, new Set(['chicken', 'salt', 'rice']))).toBe('all')
	// A stale pick of an added line counts for nothing.
	expect(mealPickState(lines, new Set(['lemon']))).toBe('none')
	expect(mealPickState(lines, new Set(['lemon', 'chicken']))).toBe('some')
})

test('a Meal whose lines are on the list or usually on hand is done until one is ticked', () => {
	const meal = [line('lemon', 'added'), line('salt', 'on-hand')]
	expect(mealPickState(meal, new Set())).toBe('done')
	expect(defaultPickedLines(meal)).toEqual([])
	// The salt line can still be ticked on its own, and then the box counts it.
	expect(mealPickState(meal, new Set(['salt']))).toBe('all')
	expect(
		mealPickState([...meal, line('pepper', 'on-hand')], new Set(['salt'])),
	).toBe('some')
	expect(mealPickState(meal, new Set())).toBe('done')
})

test('a Meal with nothing on the list, or something still to add, is never done', () => {
	const onHand = [line('salt', 'on-hand'), line('pepper', 'on-hand')]
	expect(mealPickState(onHand, new Set())).toBe('none')
	expect(
		mealPickState(
			[line('lemon', 'added'), line('chicken', 'needed')],
			new Set(),
		),
	).toBe('none')
	expect(
		mealPickState(
			[
				line('lemon', 'added'),
				line('salt', 'on-hand'),
				line('rice', 'name-on-list'),
			],
			new Set(),
		),
	).toBe('none')
})

test('a line on a Later row can be ticked but starts unticked, and the Meal isn’t done', () => {
	const later = line('lemon', 'later')
	const meal = [line('butter', 'added'), later, line('salt', 'on-hand')]
	expect(defaultPickedLines(meal)).toEqual([])
	expect(mealPickState(meal, new Set())).toBe('none')
	expect(toggleMealPicks(meal, new Set())).toEqual(new Set(['lemon', 'salt']))
	expect(mealPickState(meal, new Set(['lemon']))).toBe('some')
})
