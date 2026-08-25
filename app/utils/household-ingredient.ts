import { z } from 'zod'
import { RECOMMENDED_STAPLES } from './pantry-staples.ts'

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

const CutoverItemSchema = z.object({
	displayName: HouseholdIngredientDisplayNameSchema,
})

export const StaplesCutoverSelectionSchema = z
	.array(CutoverItemSchema)
	// Match the full-export recovery ceiling so established Pro Pantries are
	// not capped at the legacy single bulk-add batch during cutover.
	.max(1000)
	.transform((items) => {
		const unique = new Map<
			string,
			{ displayName: string; canonicalKey: string }
		>()
		for (const item of items) {
			const canonicalKey = householdIngredientKey(item.displayName)
			if (!unique.has(canonicalKey)) {
				unique.set(canonicalKey, {
					displayName: item.displayName,
					canonicalKey,
				})
			}
		}
		return [...unique.values()]
	})

export type StaplesCutoverOption = {
	displayName: string
	canonicalKey: string
	selected: boolean
	source: 'pantry' | 'previous' | 'suggestion' | 'custom'
}

export function buildStaplesCutoverOptions(
	inventoryItems: Array<{ name: string }>,
	previousStaples: Array<{ displayName: string }> = [],
): StaplesCutoverOption[] {
	const options = new Map<string, StaplesCutoverOption>()
	for (const item of inventoryItems) {
		const displayName = householdIngredientDisplayName(item.name)
		if (!displayName) continue
		const canonicalKey = householdIngredientKey(displayName)
		if (!options.has(canonicalKey)) {
			options.set(canonicalKey, {
				displayName,
				canonicalKey,
				selected: true,
				source: 'pantry',
			})
		}
	}
	for (const item of previousStaples) {
		const displayName = householdIngredientDisplayName(item.displayName)
		if (!displayName) continue
		const canonicalKey = householdIngredientKey(displayName)
		if (!options.has(canonicalKey)) {
			options.set(canonicalKey, {
				displayName,
				canonicalKey,
				selected: true,
				source: 'previous',
			})
		}
	}
	for (const suggestion of RECOMMENDED_STAPLES) {
		const displayName = householdIngredientDisplayName(suggestion.name)
		const canonicalKey = householdIngredientKey(displayName)
		if (!options.has(canonicalKey)) {
			options.set(canonicalKey, {
				displayName,
				canonicalKey,
				selected: suggestion.checked,
				source: 'suggestion',
			})
		}
	}
	return [...options.values()]
}
