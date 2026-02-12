import { z } from 'zod'

export const CookingLogSchema = z.object({
	cookedAt: z.coerce.date().optional(),
	notes: z.string().max(500).optional(),
})

export type CookingLogFormData = z.infer<typeof CookingLogSchema>
