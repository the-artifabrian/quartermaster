import { z } from 'zod'
import { ScaleMultiplierSchema } from '#app/utils/menu-validation.ts'
import { isValidTimeZone } from '#app/utils/serving-time.ts'

/** The familiar labels a Meal can carry. Optional everywhere (#98): a Meal
 * without one renders compact and unlabeled. */
export const MealLabelSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])

export const GENERIC_TEXT_MAX_LENGTH = 200

export const AddMealSchema = z.object({
	date: z.coerce.date(),
	recipeId: z.string().min(1, { message: 'Recipe is required' }),
	// Conform strips empty inputs to undefined, so "no label" arrives absent.
	label: MealLabelSchema.optional(),
	multiplier: ScaleMultiplierSchema.optional(),
})

export const AddTextMealSchema = z.object({
	date: z.coerce.date(),
	label: MealLabelSchema.optional(),
	text: z
		.string({
			error: (issue) =>
				issue.input === undefined ? 'Text is required' : undefined,
		})
		.trim()
		.min(1, { message: 'Text is required' })
		.max(GENERIC_TEXT_MAX_LENGTH, {
			message: `Keep it under ${GENERIC_TEXT_MAX_LENGTH} characters`,
		}),
})

/**
 * The edit-details form always submits every field, so an absent (empty)
 * optional means "cleared". A submitted time needs the browser's IANA zone to
 * name an instant; the zone input is hidden and filled by script, so a missing
 * pair is a forged request rather than a user mistake.
 */
export const MealDetailsSchema = z
	.object({
		mealId: z.string().min(1),
		label: MealLabelSchema.optional(),
		time: z
			.string()
			// Real clock times only — Date.UTC would silently roll "39:99" over
			// into later days, storing a servingAt off the Meal's semantic date.
			.regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'Use a time like 18:30' })
			.optional(),
		timeZone: z.string().optional(),
		guestCount: z.coerce
			.number()
			.int()
			.positive()
			.max(999, { message: 'Guest count must be 999 or less' })
			.optional(),
		text: z
			.string()
			.trim()
			.min(1, { message: 'Text is required' })
			.max(GENERIC_TEXT_MAX_LENGTH, {
				message: `Keep it under ${GENERIC_TEXT_MAX_LENGTH} characters`,
			})
			.optional(),
	})
	.refine(
		(value) =>
			value.time == null ||
			(value.timeZone != null && isValidTimeZone(value.timeZone)),
		{ path: ['time'], message: 'Time is missing its timezone' },
	)
