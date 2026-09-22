import { expect, test } from 'vitest'
import {
	defaultPickedLines,
	toggleMealPicks,
	type PlanPickerLine,
} from './shopping-plan-picker.ts'

const lines: PlanPickerLine[] = [
	{
		canonicalName: 'chicken',
		name: 'chicken',
		quantity: '1',
		unit: 'kg',
		status: 'needed',
	},
	{
		canonicalName: 'salt',
		name: 'salt',
		quantity: null,
		unit: null,
		status: 'on-hand',
	},
	{
		canonicalName: 'rice',
		name: 'rice',
		quantity: null,
		unit: null,
		status: 'on-list',
	},
]

test('only needed lines are ticked by default', () => {
	expect(defaultPickedLines(lines)).toEqual(['chicken'])
})

test('a Meal on a day already gone starts with nothing ticked', () => {
	expect(defaultPickedLines(lines, { past: true })).toEqual([])
})

test('the Meal box fills an empty Meal with its needed lines first', () => {
	expect([...toggleMealPicks(lines, new Set())]).toEqual(['chicken'])
})

test('the Meal box fills a part-ticked Meal, then empties a full one', () => {
	const full = toggleMealPicks(lines, new Set(['chicken']))
	expect([...full]).toEqual(['chicken', 'salt', 'rice'])
	expect(toggleMealPicks(lines, full).size).toBe(0)
})

test('the Meal box ticks everything when no line is needed', () => {
	const onHand = lines.filter((line) => line.status !== 'needed')
	expect([...toggleMealPicks(onHand, new Set())]).toEqual(['salt', 'rice'])
})
