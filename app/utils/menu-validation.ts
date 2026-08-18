import { z } from 'zod'

/**
 * A Menu's identity within its household: trimmed, Unicode-normalized (NFKC),
 * lower-cased. Stored beside the display title so case and spelling variants
 * of the same name collide predictably (library identity and recovery both
 * rely on it).
 */
export function menuTitleKey(title: string) {
	return title.trim().normalize('NFKC').toLowerCase()
}

export const MenuTitleSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Title is required' : undefined,
	})
	.trim()
	.min(1, { message: 'Title is required' })
	.max(100, { message: 'Title is too long' })

export const MenuSchema = z.object({
	title: MenuTitleSchema,
	description: z
		.string()
		.max(500, { message: 'Description is too long' })
		.optional(),
	defaultGuestCount: z.coerce
		.number({ error: 'Guests must be a number' })
		.int({ message: 'Guests must be a whole number' })
		.min(1, { message: 'Guests must be at least 1' })
		.max(999, { message: 'Guests must be under 1000' })
		.optional(),
})

export type MenuFormData = z.infer<typeof MenuSchema>

/**
 * Positive decimal ingredient batches for one Recipe card ("1×" = one batch of
 * the Recipe's stored ingredient list). Entered as text so phone keyboards and
 * comma-decimal locales both work; capped at two decimal places to keep stored
 * multipliers displayable, and at 100 to keep obvious typos out.
 */
export const ScaleMultiplierSchema = z
	.string({
		error: (issue) =>
			issue.input === undefined ? 'Multiplier is required' : undefined,
	})
	.trim()
	.regex(/^\d{1,3}([.,]\d{1,2})?$/, {
		message: 'Use a number like 1, 1.5, or 0,75',
	})
	.transform((value) => Number(value.replace(',', '.')))
	.refine((value) => value > 0, {
		message: 'Multiplier must be more than zero',
	})
	.refine((value) => value <= 100, {
		message: 'Multiplier must be 100 or less',
	})

const MenuRecipeItemSchema = z
	.object({
		/** Existing MenuItem id; absent for a Recipe picked during this edit. */
		id: z.string().optional(),
		/** Referenced Recipe; absent only on a missing card kept as-is. */
		recipeId: z.string().optional(),
		scaleMultiplier: ScaleMultiplierSchema,
		note: z.string().max(500, { message: 'Note is too long' }).optional(),
	})
	.refine((item) => item.id != null || item.recipeId != null, {
		message: 'Pick a recipe for this card',
	})

export const SECTION_NAME_REQUIRED_MESSAGE = 'Section name is required'

export const MenuSectionNameSchema = z
	.string()
	.trim()
	.min(1, { message: SECTION_NAME_REQUIRED_MESSAGE })
	.max(100, { message: 'Section name is too long' })

const MenuBuilderSectionSchema = z
	.object({
		/** Existing MenuSection id; absent for a section added during this edit. */
		id: z.string().optional(),
		/** Absent on the durable unnamed section, which never carries a name. */
		name: MenuSectionNameSchema.optional(),
		items: z.array(MenuRecipeItemSchema).optional(),
	})
	// A new section is always custom, so it needs a name up front; existing
	// custom sections are checked server-side against the stored unnamed id.
	.refine((section) => section.id != null || section.name != null, {
		message: SECTION_NAME_REQUIRED_MESSAGE,
		path: ['name'],
	})

export const MenuBuilderSchema = MenuSchema.extend({
	sections: z
		.array(MenuBuilderSectionSchema)
		.max(20, { message: 'A menu can hold at most 20 sections' })
		.superRefine((sections, ctx) => {
			const total = sections.reduce(
				(count, section) => count + (section.items?.length ?? 0),
				0,
			)
			if (total > 100) {
				ctx.addIssue({
					code: 'custom',
					message: 'A menu can hold at most 100 recipes',
				})
			}
		})
		.optional(),
})

/** The builder form's pre-parse shape — what conform renders and submits. */
export type MenuBuilderInput = z.input<typeof MenuBuilderSchema>
export type MenuSectionInput = NonNullable<MenuBuilderInput['sections']>[number]
export type MenuItemInput = NonNullable<MenuSectionInput['items']>[number]

export const DUPLICATE_MENU_RECIPE_MESSAGE =
	'Each recipe can appear only once per menu'

/**
 * Renders a stored multiplier the way it was typed: at most two decimals, no
 * trailing zeros ("1", "1.5", "0.75").
 */
export function formatScaleMultiplier(value: number) {
	return String(Math.round(value * 100) / 100)
}

/**
 * True for Prisma's unique-constraint error (P2002) — the shape both menu
 * actions catch to turn a `householdId`+`titleKey` collision into a friendly
 * field error instead of a 500.
 */
export function isUniqueConstraintError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === 'P2002'
	)
}

export const DUPLICATE_MENU_TITLE_MESSAGE =
	'A menu with this title already exists'
