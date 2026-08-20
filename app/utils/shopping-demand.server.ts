import { parseAmount, formatAmount, scaleAmount } from './fractions.ts'
import { parseIngredient } from './ingredient-parser.ts'
import { scaleUpMetric } from './metric-conversion.ts'
import {
	getCanonicalIngredientName,
	isOptionalIngredient,
} from './recipe-matching.server.ts'
import { guessCategory } from './shopping-list-validation.ts'
import {
	normalizeUnit,
	getUnitFamily,
	convertAndSum,
} from './unit-conversion.ts'

/**
 * The one pure Shopping-demand module (#108). Recipe ingredient batches with
 * positive scale multipliers plus ordinary note Shopping lines go in;
 * normalized demand lines come out, with unresolved input preserved rather
 * than dropped or falsely totalled. Deterministic and persistence-free by
 * design: this interface never accepts Inventory, Staples, displayed
 * Shopping rows, or persistence state. Availability annotation
 * (shopping-list.server.ts) and transactional contribution reconciliation
 * (shopping-contribution.server.ts) consume the output at separate seams.
 */

export type DemandIngredient = {
	name: string
	amount: string | null
	unit: string | null
	isHeading?: boolean
	notes?: string | null
}

/**
 * One Recipe's stored ingredient list at a positive decimal batch multiplier
 * — the Meal item's stored scale multiplier (#98). Absent means one batch.
 */
export type RecipeIngredientBatch = {
	ingredients: DemandIngredient[]
	scaleMultiplier?: number | null
}

/** An ordinary free-text Shopping line — a Menu/Meal note line or bulk add. */
export type NoteShoppingLine = {
	name: string
	quantity?: string | null
	unit?: string | null
}

export type ShoppingDemandLine = {
	/** Cleaned display name. */
	name: string
	/** Normalized demand identity — dedup and contribution keying. */
	canonicalName: string
	quantity: string | null
	unit: string | null
	category: string
}

// Safety net: detect ingredients that look like section headings but aren't
// marked with isHeading (e.g. from manual entry or import paths that don't
// detect headings).
const HEADING_EXACT =
	/^(?:sauce|marinade|filling|topping|glaze|garnish|dressing|batter|crust|frosting|assembly|spice mix|dry ingredients|wet ingredients|meat and marinade|stir[- ]?fry|quick marinade|broth)$/i
const HEADING_PREFIX =
	/^(?:for the |for |the |quick (?:marinade|sauce|dressing) )/i

/**
 * Normalized demand identity. Falls back to the trimmed lowercased display
 * name when canonicalization empties the string (e.g. "medium/small
 * peaches") — an empty identity would collapse unrelated ingredients into
 * one false total and collide contribution keys. Every consumer that
 * compares demand lines against stored Shopping rows must derive the rows'
 * identity through this same function, or fallback-identity lines can never
 * match their rows.
 */
export function demandIdentity(name: string): string {
	return getCanonicalIngredientName(name) || name.trim().toLowerCase()
}

function looksLikeHeading(ingredient: {
	name: string
	amount: string | null
	unit: string | null
}): boolean {
	if (ingredient.amount || ingredient.unit) return false
	const name = ingredient.name.trim()
	if (!name || name.length > 60) return false
	// Ends with colon (e.g. "For the sauce:")
	if (name.endsWith(':')) return true
	// Matches known heading patterns
	if (HEADING_EXACT.test(name)) return true
	if (HEADING_PREFIX.test(name)) return true
	return false
}

/**
 * Build normalized Shopping demand. Recipe ingredients are scaled by their
 * batch multiplier, cleaned, and consolidated by canonical identity with
 * compatible-unit summation. Note lines pass through individually — free
 * text is preserved as given, never merged into false totals (#109 owns
 * richer aggregation).
 */
export function buildShoppingDemand({
	recipeBatches = [],
	noteLines = [],
}: {
	recipeBatches?: RecipeIngredientBatch[]
	noteLines?: NoteShoppingLine[]
}): ShoppingDemandLine[] {
	const ingredientMap = new Map<
		string,
		{
			name: string
			quantities: Array<{ amount?: string | null; unit?: string | null }>
			category: string
		}
	>()

	for (const batch of recipeBatches) {
		const { ingredients, scaleMultiplier } = batch
		const ratio = scaleMultiplier && scaleMultiplier > 0 ? scaleMultiplier : 1

		for (const ingredient of ingredients) {
			if (ingredient.isHeading) continue
			if (looksLikeHeading(ingredient)) continue
			if (
				isOptionalIngredient({ ...ingredient, notes: ingredient.notes ?? null })
			)
				continue

			// Re-parse ingredients that have no amount but name starts with a quantity
			let effectiveName = ingredient.name
			let effectiveAmount = ingredient.amount
			let effectiveUnit = ingredient.unit
			if (!effectiveAmount && /^(?:~?\d|[½⅓⅔¼¾⅛⅜⅝⅞])/.test(effectiveName)) {
				const reparsed = parseIngredient(effectiveName)
				if (reparsed?.name && reparsed?.amount) {
					effectiveName = reparsed.name
					effectiveAmount = reparsed.amount
					effectiveUnit = reparsed.unit ?? null
				}
			}

			// Strip leading "of " from display names (parser artifact)
			if (effectiveName.startsWith('of ')) {
				effectiveName = effectiveName.slice(3)
			}

			const normalizedName = demandIdentity(effectiveName)

			// Scale the amount by the batch multiplier
			const scaledAmount = scaleAmountString(
				effectiveAmount,
				ratio,
				effectiveUnit,
			)

			if (ingredientMap.has(normalizedName)) {
				ingredientMap.get(normalizedName)!.quantities.push({
					amount: scaledAmount,
					unit: effectiveUnit,
				})
			} else {
				ingredientMap.set(normalizedName, {
					name: effectiveName,
					quantities: [{ amount: scaledAmount, unit: effectiveUnit }],
					category: guessCategory(effectiveName),
				})
			}
		}
	}

	const lines: ShoppingDemandLine[] = []

	for (const [canonicalName, data] of ingredientMap) {
		const consolidated = consolidateQuantities(data.quantities)

		lines.push({
			name: data.name,
			canonicalName,
			quantity: consolidated.quantity ?? null,
			unit: consolidated.unit ?? null,
			category: data.category,
		})
	}

	lines.sort((a, b) => a.category.localeCompare(b.category))

	for (const line of noteLines) {
		const name = line.name.trim()
		if (!name) continue
		lines.push({
			name,
			canonicalName: demandIdentity(name),
			quantity: line.quantity?.trim() || null,
			unit: line.unit?.trim() || null,
			category: guessCategory(name),
		})
	}

	return lines
}

export function scaleAmountString(
	amount: string | null,
	ratio: number,
	unit?: string | null,
): string | null {
	if (!amount || ratio === 1) return amount
	return scaleAmount(amount, ratio, unit)
}

// Sum numeric quantities with same unit, or convert compatible units, or show count
export function consolidateQuantities(
	quantities: Array<{ amount?: string | null; unit?: string | null }>,
): { quantity?: string; unit?: string } {
	if (quantities.length === 0) return {}
	if (quantities.length === 1) {
		return {
			quantity: quantities[0]!.amount ?? undefined,
			unit: quantities[0]!.unit ?? undefined,
		}
	}

	// Normalize all units
	const normalized = quantities.map((q) => ({
		amount: q.amount,
		unit: q.unit,
		normalizedUnit: q.unit ? normalizeUnit(q.unit) : '',
	}))

	// Check if all have the same normalized unit
	const firstNormUnit = normalized[0]!.normalizedUnit
	const sameNormUnit = normalized.every(
		(q) => q.normalizedUnit === firstNormUnit,
	)

	if (sameNormUnit) {
		const numericQuantities = normalized
			.map((q) => parseAmount(q.amount ?? ''))
			.filter((n): n is number => n !== null)

		if (numericQuantities.length === quantities.length) {
			const sum = numericQuantities.reduce((a, b) => a + b, 0)
			// Metric sums scale up like the conversion branch: 1500 g → 1.5 kg
			if (firstNormUnit === 'g' || firstNormUnit === 'ml') {
				const scaled = scaleUpMetric(sum, firstNormUnit)
				if (scaled.unit !== firstNormUnit) {
					return {
						quantity: formatAmount(scaled.amount, scaled.unit),
						unit: scaled.unit,
					}
				}
			}
			return {
				quantity: formatAmount(sum, normalized[0]!.unit),
				unit: normalized[0]!.unit ?? undefined,
			}
		}
	}

	// Try unit conversion within the same family
	const parsed = normalized.map((q) => {
		const amount = parseAmount(q.amount ?? '')
		if (amount === null) return null
		const family = q.normalizedUnit ? getUnitFamily(q.normalizedUnit) : null
		if (!family) return null
		return {
			amount,
			normalizedUnit: q.normalizedUnit,
			familyName: family.family.name,
			family: family.family,
		}
	})

	// All must be parseable and in the same family
	if (parsed.every((p) => p !== null)) {
		const firstFamily = parsed[0]!.familyName
		if (parsed.every((p) => p!.familyName === firstFamily)) {
			const result = convertAndSum(
				parsed.map((p) => ({
					amount: p!.amount,
					normalizedUnit: p!.normalizedUnit,
				})),
				parsed[0]!.family,
			)
			return {
				quantity: formatAmount(result.value, result.unit),
				unit: result.unit,
			}
		}
	}

	return { quantity: `${quantities.length}×`, unit: undefined }
}
