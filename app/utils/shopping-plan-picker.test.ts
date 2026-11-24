/**
 * The From Plan picker's line statuses and tick rules.
 *
 * Failure list:
 * - A line this Meal already put on Shopping reads as merely sharing a name
 *   with a row, or as usually on hand, so it can be ticked again.
 * - A line whose name is on the list through a typed row, a Recipe row or
 *   another Meal reads as this Meal's own amount, so the household can't add
 *   this Meal's share to it.
 * - An added line is ticked by default, counts as picked, or is ticked by
 *   the Meal box's tick-all.
 * - The Meal box compares picks with every line, added ones included, so a
 *   Meal with added lines never reads as fully ticked, and its next tap
 *   ticks again instead of emptying.
 * - A Meal whose lines are all added reads as unticked, or its box ticks
 *   something.
 * - A stale pick of an added line (left from before the list changed)
 *   counts toward the Meal box.
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
	const status = (canonicalName: string, added: string[]) =>
		planPickerLineStatus({
			canonicalName,
			addedIdentities: new Set(added),
			listedIdentities: new Set(['lemon', 'rice']),
			keptByAvailability: new Set(['lemon', 'rice', 'chicken']),
			pantryStaple: canonicalName === 'salt',
		})
	expect(status('lemon', ['lemon'])).toBe('added')
	// Its row could be the only row with the name, or a Staple's name.
	expect(status('salt', ['salt'])).toBe('added')
	expect(status('rice', [])).toBe('name-on-list')
	expect(status('salt', [])).toBe('on-hand')
	expect(status('chicken', [])).toBe('needed')
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
