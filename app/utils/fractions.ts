import { MAX_INGREDIENT_AMOUNT_LENGTH } from './recipe-validation.ts'
import { isMetricUnit, round2 } from './unit-conversion.ts'

/** Unicode fraction characters → numeric values */
const UNICODE_FRACTIONS: Record<string, number> = {
	'½': 1 / 2,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'¼': 1 / 4,
	'¾': 3 / 4,
	'⅛': 1 / 8,
	'⅜': 3 / 8,
	'⅝': 5 / 8,
	'⅞': 7 / 8,
}

const UNICODE_FRACTION_PATTERN = /[½⅓⅔¼¾⅛⅜⅝⅞]/

// One to three digits that don't start with 0, then a single comma or dot
// and exactly three digits: "1,250", "1.000". A Romanian scale writes 1.25 kg
// as "1,250", and "1.000" is one thousand in Romanian but one in English, so
// neither has a single value.
const THOUSANDS_LOOKALIKE = /^[1-9]\d{0,2}[.,]\d{3}$/
// Two or more comma groups, or one before a decimal dot, can only be
// thousands: "1,000,000", "1,000.5".
const COMMA_THOUSANDS = /^[1-9]\d{0,2}(?:(?:,\d{3}){2,}(?:\.\d+)?|,\d{3}\.\d+)$/
// Any other single comma between digits is a decimal comma: "1,5", "0,500".
const COMMA_DECIMAL = /^\d+,\d+$/
const DOT_DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/
// Thousands grouped with spaces, as French sites write them: a plain space, a
// no-break space or a narrow no-break space, then an optional decimal with a
// comma or a dot. A space is never a decimal mark.
const SPACE_THOUSANDS =
	/^[1-9]\d{0,2}((?:[ \u00A0\u202F]\d{3})+)(?:[.,](\d+))?$/

/**
 * The value of an amount with spaces between thousands, or null when it has
 * none. One group that doesn't start with 0 ("2 400") could be a count times
 * a size, two 400 g tins, so only "1 000", "2 050" and two or more groups
 * ("1 000 000") count. A decimal of exactly three digits ("1 000,000") could
 * be another group, so it doesn't either.
 */
function spaceThousands(amount: string): number | null {
	const match = SPACE_THOUSANDS.exec(amount)
	if (!match) return null
	const groups = match[1]!
	const decimals = match[2]
	if (decimals?.length === 3) return null
	if (groups.length === 4 && groups[1] !== '0') return null
	const digits = amount.replace(/[ \u00A0\u202F]/g, '').replace(',', '.')
	return Number(digits)
}

/**
 * One number as it can be written, as a pattern source: thousands split by
 * spaces ("1 000", "1 000,5") or digits joined by dots and commas
 * ("1,000,000", "1,5"). It only finds where the number ends; parseAmount
 * says what it means. Neither part lets two quantifiers take turns over the
 * same digits, so it stays linear.
 */
export const WRITTEN_NUMBER = String.raw`\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[.,]\d+)?(?![\d.,\-–])|\d+(?:[.,]\d+)*`

/**
 * The value of a yield's number (a WRITTEN_NUMBER match) and how many of its
 * characters it used. One group after a space that parseAmount can't read is
 * a count before a size, as in "Makes 4 500 ml jars", so only the count is
 * used. Null when the number has no single value ("1,000").
 */
export function readYieldNumber(
	written: string,
): { value: number; length: number } | null {
	const value = parseAmount(written)
	if (value !== null) return { value, length: written.length }
	const count = /^(\d{1,3})[ \u00A0\u202F]\d{3}$/.exec(written)?.[1]
	return count ? { value: Number(count), length: count.length } : null
}

/**
 * Parse a string amount into a number, or null when the whole string isn't
 * one number. Handles fractions ("1/2"), mixed numbers ("1 1/2"), decimals
 * with a dot or a comma ("1.5", "1,5"), thousands separators ("1,000,000"),
 * unicode fractions ("½", "¾"), and mixed unicode ("1½", "1 ½").
 *
 * This is the one place an amount gets a numeric value; everything that
 * scales, sums, converts or counts asks it. Anything it can't read, such as
 * "2 large", "2 x 400" or an ambiguous "1,250", stays as written and out of
 * every sum, so the app never shows a false total.
 */
export function parseAmount(amount: string): number | null {
	const trimmed = amount.trim().replaceAll('\u2044', '/')
	// Nothing longer can be saved as an amount, so it isn't one.
	if (!trimmed || trimmed.length > MAX_INGREDIENT_AMOUNT_LENGTH) return null

	// Unicode fraction (standalone): "½", "¾"
	if (trimmed.length === 1 && UNICODE_FRACTIONS[trimmed] !== undefined) {
		return UNICODE_FRACTIONS[trimmed]!
	}

	// Mixed unicode fraction: "1½", "1 ½", "2¾", "2 ¼"
	if (UNICODE_FRACTION_PATTERN.test(trimmed)) {
		const mixedUnicode = trimmed.match(/^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/)
		if (mixedUnicode) {
			const whole = parseInt(mixedUnicode[1]!, 10)
			const frac = UNICODE_FRACTIONS[mixedUnicode[2]!]
			if (frac !== undefined) return whole + frac
		}
	}

	// Mixed number: "1 1/2"
	const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/)
	if (mixedMatch) {
		const whole = parseInt(mixedMatch[1]!, 10)
		const num = parseInt(mixedMatch[2]!, 10)
		const den = parseInt(mixedMatch[3]!, 10)
		if (den === 0) return null
		return whole + num / den
	}

	// Simple fraction: "1/2"
	const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/)
	if (fractionMatch) {
		const num = parseInt(fractionMatch[1]!, 10)
		const den = parseInt(fractionMatch[2]!, 10)
		if (den === 0) return null
		return num / den
	}

	if (SPACE_THOUSANDS.test(trimmed)) return spaceThousands(trimmed)
	if (THOUSANDS_LOOKALIKE.test(trimmed)) return null
	if (COMMA_THOUSANDS.test(trimmed)) return Number(trimmed.replaceAll(',', ''))
	if (COMMA_DECIMAL.test(trimmed)) return Number(trimmed.replace(',', '.'))
	if (DOT_DECIMAL.test(trimmed)) return Number(trimmed)
	return null
}

// Common fractions for display, ordered by denominator then numerator
const COMMON_FRACTIONS: Array<{ value: number; display: string }> = [
	{ value: 1 / 8, display: '1/8' },
	{ value: 1 / 4, display: '1/4' },
	{ value: 1 / 3, display: '1/3' },
	{ value: 3 / 8, display: '3/8' },
	{ value: 1 / 2, display: '1/2' },
	{ value: 5 / 8, display: '5/8' },
	{ value: 2 / 3, display: '2/3' },
	{ value: 3 / 4, display: '3/4' },
	{ value: 7 / 8, display: '7/8' },
]

/**
 * Format a number as a human-readable amount.
 * Snaps to nearest common fraction (1/8, 1/4, 1/3, 1/2, 2/3, 3/4).
 * Returns mixed numbers for values > 1 (e.g., "1 1/2").
 * Metric units (g, kg, ml, l) are kept as decimals — "0.4 g", not "3/8 g".
 *
 * This is the EXACT policy: author-written and scaled amounts keep their
 * precision. Approximate density conversions use roundMetricAmount in
 * metric-conversion.ts, which rounds shopper-friendly instead.
 */
export function formatAmount(value: number, unit?: string | null): string {
	if (value <= 0) return '0'

	if (unit && isMetricUnit(unit)) {
		return round2(value).toString()
	}

	const whole = Math.floor(value)
	const fractional = value - whole

	// If close to a whole number
	if (fractional < 0.05) {
		return whole.toString()
	}
	if (fractional > 0.95) {
		return (whole + 1).toString()
	}

	const snapped = snapToCommonFraction(fractional)

	// If not close enough to any common fraction, use decimal
	if (!snapped) {
		return round2(value).toString()
	}

	if (whole === 0) {
		return snapped.display
	}
	return `${whole} ${snapped.display}`
}

function snapToCommonFraction(
	fractional: number,
): { value: number; display: string } | null {
	let closest = COMMON_FRACTIONS[0]!
	let minDiff = Math.abs(fractional - closest.value)

	for (const frac of COMMON_FRACTIONS) {
		const diff = Math.abs(fractional - frac.value)
		if (diff < minDiff) {
			minDiff = diff
			closest = frac
		}
	}

	return minDiff > 0.05 ? null : closest
}

/**
 * A range amount like "1-2", "2 to 3", or "1½–2". Ranges are honest input:
 * they scale end by end but never sum, so every caller asks this first
 * (#109, #384). parseAmount reads no range as a number.
 */
const RANGE_AMOUNT =
	/^\s*(\d[\d\s.,/½⅓⅔¼¾⅛⅜⅝⅞]*?|[½⅓⅔¼¾⅛⅜⅝⅞])\s*([-–—~]|to)\s*(\d[\d\s.,/½⅓⅔¼¾⅛⅜⅝⅞]*|[½⅓⅔¼¾⅛⅜⅝⅞])\s*$/i

export function isRangeAmount(amount: string): boolean {
	return amount.length <= MAX_AMOUNT_TEXT && RANGE_AMOUNT.test(amount)
}

// RANGE_AMOUNT lets its ends hold spaces, so it is only ever run on text
// short enough to be an amount, with room for spaces around it.
const MAX_AMOUNT_TEXT = MAX_INGREDIENT_AMOUNT_LENGTH * 2

/**
 * Both ends of a range and the dash to rejoin them with: a hyphen or en dash
 * as the author wrote it, otherwise a hyphen ("~" before a digit reads as
 * "about", so "2~4" would be noise). Null when either end defeats parsing, or
 * the low end is above the high one, so the caller passes the range through
 * verbatim rather than collapsing it.
 */
export function parseRangeAmount(
	amount: string,
): { low: number; high: number; separator: string } | null {
	if (!isRangeAmount(amount)) return null
	const match = RANGE_AMOUNT.exec(amount)
	if (!match) return null
	const low = parseAmount(match[1]!)
	const high = parseAmount(match[3]!)
	if (low === null || high === null || low > high) return null
	const separator = match[2] === '–' ? '–' : '-'
	return { low, high, separator }
}

/**
 * Scale an ingredient amount string by a ratio.
 * Returns the scaled amount as a formatted string, or the original if
 * unparseable. A range scales end by end ("1-2" ×2 → "2-4").
 */
export function scaleAmount(
	amount: string | null | undefined,
	ratio: number,
	unit?: string | null,
): string | null {
	if (!amount) return null
	if (isRangeAmount(amount)) {
		const range = parseRangeAmount(amount)
		if (!range) return amount
		return `${formatAmount(range.low * ratio, unit)}${range.separator}${formatAmount(range.high * ratio, unit)}`
	}
	const parsed = parseAmount(amount)
	if (parsed === null) return amount
	return formatAmount(parsed * ratio, unit)
}

export type KitchenAmount = {
	display: string
	/**
	 * True when the display was numerically rounded away from the exact scaled
	 * value (callers prefix ≈). Fraction translations ("generous 1/2") stay
	 * false — the qualifier word already carries the approximation.
	 */
	approximate: boolean
	/**
	 * Exact scaled numeric value, for downstream conversion (e.g. metric).
	 * Null for a range or an unparseable amount, which have no single value.
	 */
	value: number | null
}

/**
 * Eighths that no measuring-spoon set has, translated to the nearest spoon
 * that exists with a cook's qualifier: 5/8 tsp is "generous 1/2 tsp".
 * 7/8 carries into "scant <next whole>".
 */
const KITCHEN_FRACTION_QUALIFIERS: Record<
	string,
	{ qualifier: 'generous' | 'scant'; display: string; carry?: boolean }
> = {
	'3/8': { qualifier: 'generous', display: '1/3' },
	'5/8': { qualifier: 'generous', display: '1/2' },
	'7/8': { qualifier: 'scant', display: '', carry: true },
}

/**
 * Round a scaled metric amount to a measurable kitchen quantity. Slightly
 * coarser than roundMetricAmount in metric-conversion.ts: scaling already
 * introduced false precision, so 312.5 g reads better as "≈310 g" than as
 * a number no scale shows.
 */
function roundKitchenMetric(value: number, unit: string): number {
	if (isKgOrLiter(unit)) {
		return Math.round(value * 10) / 10
	}
	if (value >= 200) return Math.round(value / 10) * 10
	if (value > 50) return Math.round(value / 5) * 5
	if (value < 1) return round2(value)
	return Math.round(value)
}

function isKgOrLiter(unit: string): boolean {
	return /^(kg|kilograms?|l|liters?|litres?)$/i.test(unit.trim())
}

/**
 * Scale an ingredient amount for *display while cooking*: rounds to
 * quantities a kitchen can actually measure (312.5 g → ≈310 g, 5/8 tsp →
 * "generous 1/2" tsp). Author-written amounts (ratio 1) keep their exact
 * precision — kitchen rounding only smooths what scaling itself invented.
 * Shopping-list quantities keep using scaleAmount (exact policy).
 */
export function scaleAmountKitchen(
	amount: string | null | undefined,
	ratio: number,
	unit?: string | null,
): KitchenAmount | null {
	if (!amount) return null
	const verbatim = { display: amount, approximate: false, value: null }
	if (isRangeAmount(amount)) {
		const range = parseRangeAmount(amount)
		if (!range) return verbatim
		const low = scaleValueKitchen(range.low, ratio, unit)
		const high = scaleValueKitchen(range.high, ratio, unit)
		return {
			display: `${low.display}${range.separator}${high.display}`,
			approximate: low.approximate || high.approximate,
			value: null,
		}
	}
	const parsed = parseAmount(amount)
	if (parsed === null) return verbatim
	return scaleValueKitchen(parsed, ratio, unit)
}

function scaleValueKitchen(
	parsed: number,
	ratio: number,
	unit?: string | null,
): KitchenAmount {
	const value = parsed * ratio
	if (ratio === 1) {
		return { display: formatAmount(value, unit), approximate: false, value }
	}

	if (unit && isMetricUnit(unit)) {
		const rounded = roundKitchenMetric(value, unit)
		return {
			display: rounded.toString(),
			approximate: rounded !== round2(value),
			value,
		}
	}

	const exact = formatAmount(value, unit)
	const whole = Math.floor(value)
	const fractional = value - whole
	if (fractional < 0.05 || fractional > 0.95) {
		return { display: exact, approximate: false, value }
	}

	const snapped = snapToCommonFraction(fractional)
	const kitchen = snapped ? KITCHEN_FRACTION_QUALIFIERS[snapped.display] : null
	if (!kitchen) {
		return { display: exact, approximate: false, value }
	}

	if (kitchen.carry) {
		return { display: `scant ${whole + 1}`, approximate: false, value }
	}
	const fractionPart =
		whole === 0 ? kitchen.display : `${whole} ${kitchen.display}`
	return {
		display: `${kitchen.qualifier} ${fractionPart}`,
		approximate: false,
		value,
	}
}
