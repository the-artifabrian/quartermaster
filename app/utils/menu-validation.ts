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
