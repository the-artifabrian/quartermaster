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
	isCountUnit,
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
	/**
	 * True when any part of this line came from an ordinary note Shopping
	 * line. Note lines are explicit user-written shopping text, so the
	 * availability seam keeps them even when they look like staples — same
	 * posture as manual rows and bulk add (#109).
	 */
	fromNote?: boolean
}

export type DemandFingerprintLine = Pick<
	ShoppingDemandLine,
	'canonicalName' | 'name' | 'quantity' | 'unit'
>

/**
 * Stable current-demand fingerprint shared by freshly built demand and the
 * contribution rows that recorded what was last added. Display-only fields
 * such as category and availability deliberately do not participate.
 */
export function demandFingerprint(lines: DemandFingerprintLine[]): string {
	return JSON.stringify(
		lines
			.map((line) => [line.canonicalName, line.name, line.quantity, line.unit])
			.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
	)
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
 * batch multiplier and cleaned; then all demand — Recipe ingredients and
 * note Shopping lines alike — consolidates by demand identity with
 * deterministic compatible-unit summation (#109). Note lines need no
 * canonical ingredient identity: demandIdentity()'s trimmed-lowercase
 * fallback covers them. What cannot merge honestly (free text, incompatible
 * units, ranges, unparseable values) stays visible as separate parts of one
 * line — never a false total.
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
			fromNote: boolean
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
					fromNote: false,
				})
			}
		}
	}

	// Note lines join the same consolidation by demand identity, so a note
	// line and a Recipe ingredient for the same thing become one line. They
	// skip the Recipe-only cleaning above: they are already deliberate
	// shopping text, not parsed ingredient prose.
	for (const line of noteLines) {
		const name = line.name.trim()
		if (!name) continue
		const identity = demandIdentity(name)
		const quantity = {
			amount: line.quantity?.trim() || null,
			unit: line.unit?.trim() || null,
		}
		const existing = ingredientMap.get(identity)
		if (existing) {
			existing.quantities.push(quantity)
			existing.fromNote = true
		} else {
			ingredientMap.set(identity, {
				name,
				quantities: [quantity],
				category: guessCategory(name),
				fromNote: true,
			})
		}
	}

	const lines: ShoppingDemandLine[] = []

	for (const [canonicalName, data] of ingredientMap) {
		const consolidated = combineDemandParts(data.quantities)

		lines.push({
			name: data.name,
			canonicalName,
			quantity: consolidated.quantity,
			unit: consolidated.unit,
			category: data.category,
			...(data.fromNote ? { fromNote: true } : {}),
		})
	}

	lines.sort((a, b) => a.category.localeCompare(b.category))

	return lines
}

/**
 * A range amount like "1-2", "2 to 3", or "1½–2". Ranges are honest input:
 * they scale end-by-end but never sum — parseFloat would silently read
 * "1-2" as 1 and fabricate a false total (#109).
 */
const RANGE_AMOUNT =
	/^\s*(\d[\d\s./½⅓⅔¼¾⅛⅜⅝⅞]*?|[½⅓⅔¼¾⅛⅜⅝⅞])\s*(?:[-–—~]|to)\s*(\d[\d\s./½⅓⅔¼¾⅛⅜⅝⅞]*|[½⅓⅔¼¾⅛⅜⅝⅞])\s*$/i

export function isRangeAmount(amount: string): boolean {
	return RANGE_AMOUNT.test(amount)
}

function parseRangeAmount(
	amount: string,
): { low: number; high: number } | null {
	const match = RANGE_AMOUNT.exec(amount)
	if (!match) return null
	const low = parseAmount(match[1]!)
	const high = parseAmount(match[2]!)
	if (low === null || high === null) return null
	return { low, high }
}

export function scaleAmountString(
	amount: string | null,
	ratio: number,
	unit?: string | null,
): string | null {
	if (!amount || ratio === 1) return amount
	if (isRangeAmount(amount)) {
		const range = parseRangeAmount(amount)
		// A range scales end-by-end ("1-2" ×2 → "2-4"); one that defeats
		// parsing passes through verbatim rather than collapsing to one end.
		if (!range) return amount
		return `${formatAmount(range.low * ratio, unit)}-${formatAmount(range.high * ratio, unit)}`
	}
	return scaleAmount(amount, ratio, unit)
}

export type DemandPart = {
	amount?: string | null
	unit?: string | null
}

type SummableGroup = {
	firstIndex: number
	familyName: string | null
	members: Array<{ value: number; normalizedUnit: string }>
	/** First-seen original unit spelling — display keeps the author's word. */
	displayUnit: string | null
}

/**
 * Grouping key for one parsed numeric part. Count-like units merge with
 * unitless; units in a known family merge across the family; unknown units
 * merge only on the same word (with naive plural folding, so "bottle" and
 * "bottles" meet).
 */
function summableKey(normalizedUnit: string): {
	key: string
	familyName: string | null
	memberUnit: string
} {
	if (isCountUnit(normalizedUnit)) {
		return { key: 'count:', familyName: null, memberUnit: '' }
	}
	const family = getUnitFamily(normalizedUnit)
	if (family) {
		return {
			key: `family:${family.family.name}`,
			familyName: family.family.name,
			memberUnit: normalizedUnit,
		}
	}
	const singular =
		normalizedUnit.length > 2 &&
		normalizedUnit.endsWith('s') &&
		!normalizedUnit.endsWith('ss')
			? normalizedUnit.slice(0, -1)
			: normalizedUnit
	return { key: `unit:${singular}`, familyName: null, memberUnit: singular }
}

/**
 * Combine several quantity parts for one demand identity into an honest
 * display value (#109). Parseable amounts in compatible units sum
 * deterministically; everything else — free text, ranges, incompatible
 * units — stays visible as a ` + `-joined composite instead of a count or a
 * false total. Amountless parts add no quantitative information and drop
 * out when quantified parts exist.
 */
export function combineDemandParts(parts: DemandPart[]): {
	quantity: string | null
	unit: string | null
} {
	if (parts.length === 0) return { quantity: null, unit: null }
	if (parts.length === 1) {
		return {
			quantity: parts[0]!.amount?.trim() || null,
			unit: parts[0]!.unit?.trim() || null,
		}
	}

	const groups = new Map<string, SummableGroup>()
	const verbatims: Array<{
		firstIndex: number
		amount: string
		unit: string | null
	}> = []

	for (const [index, part] of parts.entries()) {
		const amount = part.amount?.trim()
		const unit = part.unit?.trim() || null
		if (!amount) continue

		const value = isRangeAmount(amount) ? null : parseAmount(amount)
		if (value === null) {
			verbatims.push({ firstIndex: index, amount, unit })
			continue
		}

		const normalizedUnit = unit ? normalizeUnit(unit) : ''
		const { key, familyName, memberUnit } = summableKey(normalizedUnit)
		const group = groups.get(key)
		if (group) {
			group.members.push({ value, normalizedUnit: memberUnit })
		} else {
			groups.set(key, {
				firstIndex: index,
				familyName,
				members: [{ value, normalizedUnit: memberUnit }],
				displayUnit: memberUnit === '' ? null : unit,
			})
		}
	}

	const summed = [...groups.values()].map((group) => ({
		firstIndex: group.firstIndex,
		...sumGroup(group),
	}))

	const finalParts = [...summed, ...verbatims].sort(
		(a, b) => a.firstIndex - b.firstIndex,
	)

	if (finalParts.length === 0) return { quantity: null, unit: null }
	if (finalParts.length === 1) {
		return { quantity: finalParts[0]!.amount, unit: finalParts[0]!.unit }
	}
	return {
		quantity: finalParts
			.map((part) => (part.unit ? `${part.amount} ${part.unit}` : part.amount))
			.join(' + '),
		unit: null,
	}
}

function sumGroup(group: SummableGroup): {
	amount: string
	unit: string | null
} {
	const firstUnit = group.members[0]!.normalizedUnit
	const sameUnit = group.members.every((m) => m.normalizedUnit === firstUnit)

	if (sameUnit) {
		const sum = group.members.reduce((acc, m) => acc + m.value, 0)
		// Metric sums scale up like the conversion branch: 1500 g → 1.5 kg
		if (firstUnit === 'g' || firstUnit === 'ml') {
			const scaled = scaleUpMetric(sum, firstUnit)
			if (scaled.unit !== firstUnit) {
				return {
					amount: formatAmount(scaled.amount, scaled.unit),
					unit: scaled.unit,
				}
			}
		}
		return {
			amount: formatAmount(sum, group.displayUnit),
			unit: group.displayUnit,
		}
	}

	// Mixed units within one known family (the familyName is set whenever
	// members can disagree on unit) — convert and sum.
	const family = getUnitFamily(firstUnit)!.family
	const result = convertAndSum(
		group.members.map((m) => ({
			amount: m.value,
			normalizedUnit: m.normalizedUnit,
		})),
		family,
	)
	return { amount: formatAmount(result.value, result.unit), unit: result.unit }
}

/**
 * Compute one Shopping row's displayed quantity from the row itself plus its
 * current Meal contributions (#109). Grouping happens at display time only —
 * neither the row nor any contribution is rewritten.
 * - A manual row's own quantity is the manual component; compatible
 *   generated demand combines with it, incompatible demand stays visible as
 *   separate parts.
 * - A row the contribution seam created (source 'meal') duplicates its first
 *   contribution's quantity, so its display is the contributions alone —
 *   counting the row too would double it.
 * - Week-generated and other rows keep their own quantity: their value may
 *   already include the same Meals' demand, so adding contributions on top
 *   would fabricate a false total. Their contributions stay provenance-only.
 */
export function combineRowDisplay({
	source,
	quantity,
	unit,
	contributions,
}: {
	source: string
	quantity: string | null
	unit: string | null
	contributions: Array<{ quantity: string | null; unit: string | null }>
}): { quantity: string | null; unit: string | null; combined: boolean } {
	const own = { quantity, unit, combined: false }
	if (contributions.length === 0) return own

	const contributionParts = contributions.map((c) => ({
		amount: c.quantity,
		unit: c.unit,
	}))

	if (source === 'meal') {
		const display = combineDemandParts(contributionParts)
		// Flag only what a reader could not reconstruct from the row itself:
		// several Meals' demand grouped into one number.
		return { ...display, combined: contributions.length > 1 }
	}

	if (source === 'manual') {
		const display = combineDemandParts([
			{ amount: quantity, unit },
			...contributionParts,
		])
		return { ...display, combined: true }
	}

	return own
}
