import { z } from 'zod'

export const ShoppingHorizonSchema = z.enum(['next', 'later'])
export type ShoppingHorizon = z.infer<typeof ShoppingHorizonSchema>

export const NEXT_SHOP: ShoppingHorizon = 'next'
export const LATER: ShoppingHorizon = 'later'

export function parseShoppingHorizon(
	value: FormDataEntryValue | null,
	fallback: ShoppingHorizon = NEXT_SHOP,
): ShoppingHorizon {
	const parsed = ShoppingHorizonSchema.safeParse(value)
	return parsed.success ? parsed.data : fallback
}
