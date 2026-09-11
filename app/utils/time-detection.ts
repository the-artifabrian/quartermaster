import { MAX_CUE_SCAN_LENGTH } from './cooking-cues.ts'

export type TimeMatch = {
	durationSeconds: number
	label: string
	startIndex: number
	endIndex: number
}

const UNICODE_FRACTIONS: Record<string, number> = {
	'½': 0.5,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'¼': 0.25,
	'¾': 0.75,
	'⅛': 0.125,
}

function parseNumber(s: string): number {
	// "1½" → 1.5
	for (const [frac, val] of Object.entries(UNICODE_FRACTIONS)) {
		if (s.includes(frac)) {
			const whole = s.replace(frac, '').trim()
			return (whole ? parseFloat(whole) : 0) + val
		}
	}
	// "1 1/2" or "1/2"
	const fracMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)$/)
	if (fracMatch) {
		return (
			parseInt(fracMatch[1]!, 10) +
			parseInt(fracMatch[2]!, 10) / parseInt(fracMatch[3]!, 10)
		)
	}
	const simpleFrac = s.match(/^(\d+)\/(\d+)$/)
	if (simpleFrac) {
		return parseInt(simpleFrac[1]!, 10) / parseInt(simpleFrac[2]!, 10)
	}
	return parseFloat(s)
}

function formatLabel(seconds: number): string {
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.round((seconds % 3600) / 60)
	if (hours > 0 && minutes > 0) {
		return `${hours} hr ${minutes} min`
	}
	if (hours > 0) {
		return hours === 1 ? '1 hr' : `${hours} hrs`
	}
	if (seconds < 60) {
		return `${seconds} sec`
	}
	return `${minutes} min`
}

// Temperature pattern to detect false positives like "350°F"
const TEMP_BEFORE = /°\s*$/
const TEMP_AFTER = /^\s*°[FCfc]/

/**
 * Detects time references in instruction text and returns structured matches.
 */
export function detectTimes(text: string): TimeMatch[] {
	// Bounded work per instruction — see MAX_CUE_SCAN_LENGTH.
	if (text.length > MAX_CUE_SCAN_LENGTH) return []

	const matches: TimeMatch[] = []

	// Pattern for combined times: "1 hour 30 minutes", "1 hour and 30 minutes"
	// The number is `\d[\d./…]*`, never `\d+[\d./…]*`: the trailing class already
	// contains digits, so a leading `\d+` makes the split between the two
	// quantifiers ambiguous and the engine tries every one of them before it can
	// fail. That is O(n³) on a long digit run — 5000 digits (the import schema's
	// per-instruction cap) took 2.7 minutes and wedged production. One leading
	// digit matches exactly the same language with no ambiguity. `numberPat`
	// below carries the same fix; the regression test is in time-detection.test.ts.
	const combinedPattern =
		/(?:(?:for|about|approximately|around|another|an additional)\s+)?(\d[\d./½⅓⅔¼¾⅛]*)\s*(?:hours?|hrs?)\s*(?:and\s+)?(\d[\d./½⅓⅔¼¾⅛]*)\s*(?:minutes?|mins?)/gi

	let m
	while ((m = combinedPattern.exec(text)) !== null) {
		const before = text.slice(0, m.index)
		if (TEMP_BEFORE.test(before)) continue

		const hours = parseNumber(m[1]!)
		const minutes = parseNumber(m[2]!)
		const totalSeconds = Math.round(hours * 3600 + minutes * 60)

		matches.push({
			durationSeconds: totalSeconds,
			label: formatLabel(totalSeconds),
			startIndex: m.index,
			endIndex: m.index + m[0].length,
		})
	}

	// Pattern for "an hour"
	const anHourPattern =
		/(?:(?:for|about|approximately|around|another|an additional)\s+)?an\s+hour/gi
	while ((m = anHourPattern.exec(text)) !== null) {
		// Skip if already covered by combined pattern
		if (matches.some((e) => m!.index >= e.startIndex && m!.index < e.endIndex))
			continue

		matches.push({
			durationSeconds: 3600,
			label: '1 hr',
			startIndex: m.index,
			endIndex: m.index + m[0].length,
		})
	}

	// Main pattern: N-N unit or N unit (with optional prefix)
	// Number: digits, decimals, fractions, unicode fractions, ranges
	const numberPat = `\\d[\\d./½⅓⅔¼¾⅛]*(?:\\s+\\d+/\\d+)?`
	const rangePat = `(?:${numberPat})(?:\\s*[-–]\\s*(?:${numberPat}))?`
	const unitPat = `(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)`
	const prefixPat = `(?:(?:for|about|approximately|around|another|an\\s+additional)\\s+)?`
	const mainPattern = new RegExp(
		`${prefixPat}(${rangePat})\\s*${unitPat}`,
		'gi',
	)

	while ((m = mainPattern.exec(text)) !== null) {
		// Skip if already covered by combined or "an hour" pattern
		if (matches.some((e) => m!.index >= e.startIndex && m!.index < e.endIndex))
			continue

		const before = text.slice(0, m.index)
		const after = text.slice(m.index + m[0].length)

		// Skip temperature false positives
		if (TEMP_BEFORE.test(before) || TEMP_AFTER.test(after)) continue

		const fullMatch = m[0]
		const numberStr = m[1]!

		// Determine unit from the matched string
		const unitMatch = fullMatch.match(
			/hours?|hrs?|minutes?|mins?|seconds?|secs?/i,
		)
		if (!unitMatch) continue
		const unit = unitMatch[0].toLowerCase()

		// Parse number (use upper bound for ranges)
		let value: number
		const rangeMatch = numberStr.match(
			/^([\d./½⅓⅔¼¾⅛]+(?:\s+\d+\/\d+)?)\s*[-–]\s*([\d./½⅓⅔¼¾⅛]+(?:\s+\d+\/\d+)?)$/,
		)
		if (rangeMatch) {
			value = parseNumber(rangeMatch[2]!) // upper bound
		} else {
			value = parseNumber(numberStr)
		}

		if (isNaN(value) || value <= 0) continue

		let seconds: number
		if (unit.startsWith('hour') || unit.startsWith('hr')) {
			seconds = Math.round(value * 3600)
		} else if (unit.startsWith('min')) {
			seconds = Math.round(value * 60)
		} else {
			seconds = Math.round(value)
		}

		matches.push({
			durationSeconds: seconds,
			label: formatLabel(seconds),
			startIndex: m.index,
			endIndex: m.index + m[0].length,
		})
	}

	// Sort by position in text
	matches.sort((a, b) => a.startIndex - b.startIndex)

	return matches
}
