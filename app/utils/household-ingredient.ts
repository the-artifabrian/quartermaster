import { z } from 'zod'

export function householdIngredientDisplayName(value: string) {
	return value.trim().normalize('NFKC').replace(/\s+/gu, ' ')
}

export function householdIngredientKey(value: string) {
	return householdIngredientDisplayName(value).toLowerCase()
}

export const HouseholdIngredientDisplayNameSchema = z
	.string()
	.transform(householdIngredientDisplayName)
	.pipe(z.string().min(1).max(200))
