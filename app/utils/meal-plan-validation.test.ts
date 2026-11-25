/**
 * A Meal's day is a calendar day, sent as `yyyy-MM-dd` and kept as that UTC
 * calendar day. Anything that names an instant instead could land a day off.
 */
import { describe, expect, test } from 'vitest'
import {
	AddMealSchema,
	AddMenuSchema,
	AddTextMealSchema,
	MealDetailsSchema,
	PlanMenuSchema,
} from './meal-plan-validation.ts'

const schemas = [
	{
		name: 'AddMealSchema',
		schema: AddMealSchema,
		rest: { recipeId: 'recipe-1' },
		message: 'Pick a valid date',
	},
	{
		name: 'AddMenuSchema',
		schema: AddMenuSchema,
		rest: { menuId: 'menu-1' },
		message: 'Pick a valid date',
	},
	{
		name: 'AddTextMealSchema',
		schema: AddTextMealSchema,
		rest: { text: 'Leftovers' },
		message: 'Pick a valid date',
	},
	{
		name: 'MealDetailsSchema',
		schema: MealDetailsSchema,
		rest: { mealId: 'meal-1' },
		message: 'Pick a valid date',
	},
	{
		name: 'PlanMenuSchema',
		schema: PlanMenuSchema,
		rest: {},
		message: 'Pick a date',
	},
]

describe.each(schemas)('$name date', ({ schema, rest, message }) => {
	test('reads yyyy-MM-dd as UTC midnight of that day', () => {
		const result = schema.safeParse({ ...rest, date: '2026-11-21' })
		expect(result.success).toBe(true)
		expect(result.data?.date).toEqual(new Date('2026-11-21T00:00:00.000Z'))
	})

	test.each([
		'2026-11-21T10:00:00Z',
		'2026-11-21T23:30:00-08:00',
		'2026-11-21T00:00:00',
		'1795438249407',
		'2026-02-30',
		'2026-1-5',
		'',
	])('refuses %j', (date) => {
		const result = schema.safeParse({ ...rest, date })
		expect(result.success).toBe(false)
		expect(result.error?.issues).toContainEqual(
			expect.objectContaining({ path: ['date'], message }),
		)
	})
})
