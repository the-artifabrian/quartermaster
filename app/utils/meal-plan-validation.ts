import { z } from 'zod'
import { parseDate } from '#app/utils/date.ts'
import { ScaleMultiplierSchema } from '#app/utils/menu-validation.ts'
import { isValidTimeZone } from '#app/utils/serving-time.ts'

/** The familiar labels a Meal can carry. Optional everywhere (#98): a Meal
 * without one renders compact and unlabeled. */
export const MealLabelSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])

export const GENERIC_TEXT_MAX_LENGTH = 200

/**
 * A Meal's day as the forms send it, `yyyy-MM-dd`, read as that UTC calendar
 * day (UTC midnight), the way stored days are kept. A timestamp or a full
 * datetime is refused: read as an instant, it could land on the day before
 * or after.
 */
function mealDay(message: string) {
	return z.iso.date({ message }).transform(parseDate)
}

export const AddMealSchema = z.object({
	date: mealDay('Pick a valid date'),
	recipeId: z.string().min(1, { message: 'Pick a Recipe' }),
	// Conform strips empty inputs to undefined, so "no label" arrives absent.
	label: MealLabelSchema.optional(),
	multiplier: ScaleMultiplierSchema.optional(),
})

export const AddMenuSchema = z.object({
	date: mealDay('Pick a valid date'),
	menuId: z.string().min(1, { message: 'Pick a Menu' }),
	label: MealLabelSchema.optional(),
})

export const AddTextMealSchema = z.object({
	date: mealDay('Pick a valid date'),
	label: MealLabelSchema.optional(),
	text: z
		.string({
			error: (issue) =>
				issue.input === undefined ? 'Text is required' : undefined,
		})
		.trim()
		.min(1, { message: 'Write what you’re having' })
		.max(GENERIC_TEXT_MAX_LENGTH, {
			message: `Keep it under ${GENERIC_TEXT_MAX_LENGTH} characters`,
		}),
})

// Real clock times only — Date.UTC would silently roll "39:99" over
// into later days, storing a servingAt off the Meal's semantic date.
const ServingTimeSchema = z
	.string()
	.regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'Use a time like 18:30' })

const GuestCountSchema = z.coerce
	.number()
	.int()
	.positive()
	.max(999, { message: 'Use 999 guests or fewer' })

/**
 * The edit-details form always submits every field, so an absent (empty)
 * optional means "cleared". A submitted time needs an IANA zone to
 * name an instant; the zone input is hidden and filled by script, so a missing
 * pair is a forged request rather than a user mistake.
 */
export const MealDetailsSchema = z
	.object({
		mealId: z.string().min(1),
		date: mealDay('Pick a valid date'),
		label: MealLabelSchema.optional(),
		time: ServingTimeSchema.optional(),
		timeZone: z.string().optional(),
		guestCount: GuestCountSchema.optional(),
		text: z
			.string()
			.trim()
			.min(1, { message: 'Write what you’re having' })
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

/**
 * Add to Plan from Menu detail (#107): a date plus optional label, serving
 * time, and guest count. Guest count is planning context only — the snapshot
 * copies the Menu's multipliers unchanged regardless of it.
 */
export const PlanMenuSchema = z
	.object({
		date: mealDay('Pick a date'),
		label: MealLabelSchema.optional(),
		time: ServingTimeSchema.optional(),
		timeZone: z.string().optional(),
		guestCount: GuestCountSchema.optional(),
	})
	.refine(
		(value) =>
			value.time == null ||
			(value.timeZone != null && isValidTimeZone(value.timeZone)),
		{ path: ['time'], message: 'Time is missing its timezone' },
	)
