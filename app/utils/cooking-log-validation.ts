import { z } from 'zod'

export const CookingLogSchema = z.object({
	cookedAt: z.coerce.date().optional(),
	notes: z.string().max(500).optional(),
	rating: z.preprocess(
		(v) => (v === '' || v === undefined ? undefined : v),
		z.coerce.number().int().min(1).max(5).optional(),
	),
})

export type CookingLogFormData = z.infer<typeof CookingLogSchema>
