import { expect, test } from 'vitest'
import {
	defaultPickedLines,
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
