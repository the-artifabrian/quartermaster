import {
	detectIngredientHeading,
	isAllCapsHouseStyle,
	parseIngredient,
} from './ingredient-parser.ts'

export type ParsedRecipe = {
	title: string
	description?: string
	yieldAmount?: number
	yieldLabel?: string
	ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		notes?: string
		isHeading?: boolean
	}>
	instructions: Array<{ content: string }>
	warnings: string[]
}

const HEADING_PATTERN =
	/^(ingredients|instructions|directions|steps|method|preparation)\s*:?\s*$/i

// Trailing "(Serves 2)" / "— serves 4" on a recipe title
const TITLE_SERVES_PATTERN =
	/\s*(?:\(\s*serves\s+(\d+)\s*\)|[,—–-]\s*serves\s+(\d+))\s*$/i

// A standalone explicit-yield line: "Serves 4", "Servings: 4",
// "Yield: 4 servings", or "Makes 2 loaves".
const YIELD_LINE_PATTERN =
	/^(serves?|servings?|yield|makes)\s*:?\s*(?:about\s+|approximately\s+)?(\d+(?:[.,]\d+)?)(?:\s+(.+?))?\s*\.?$/i

/**
 * Pull a trailing "(Serves N)" out of a recipe title. Returns the stripped
 * title and an explicit typed yield, or the original title with unknown yield
 * when the title doesn't carry one.
 */
export function extractYieldFromTitle(title: string): {
	title: string
	yieldAmount: number | null
	yieldLabel: string | null
} {
	const match = title.match(TITLE_SERVES_PATTERN)
	if (!match) return { title, yieldAmount: null, yieldLabel: null }
	const value = parseInt(match[1] ?? match[2] ?? '', 10)
	const stripped = title.slice(0, match.index).trim()
	if (!stripped || !value || value < 1 || value > 100) {
		return { title, yieldAmount: null, yieldLabel: null }
	}
	return { title: stripped, yieldAmount: value, yieldLabel: 'servings' }
}

function matchTypedYieldLine(line: string): {
	amount: number
	label: string
} | null {
	const match = line.match(YIELD_LINE_PATTERN)
	if (!match) return null
	const amount = Number(match[2]!.replace(',', '.'))
	if (!Number.isFinite(amount) || amount <= 0) return null
	const prefix = match[1]!.toLowerCase()
	const explicitLabel = match[3]?.replace(/[.;:,]+$/, '').trim()
	if (explicitLabel && /^(?:[-–—]|to)\s*\d/i.test(explicitLabel)) return null
	const label = explicitLabel || (/^serv/.test(prefix) ? 'servings' : '')
	return label ? { amount, label: label.slice(0, 100) } : null
}

const STEP_TRAILING_NUMBER = /\d(?:[\d.,/]*\d)?\s*°?$/
const STEP_LEADING_UNIT =
	/^(?:°\s*)?(?:F|C|Fahrenheit|Celsius|degrees?|minutes?|mins?|hours?|hrs?|seconds?|secs?|grams?|g|kg|ml|liters?|litres?|l|oz|ounces?|lbs?|pounds?|cups?|tablespoons?|tbsps?|teaspoons?|tsps?)\b/i

/**
 * Re-join instruction steps that were split in the middle of a number+unit
 * pair ("Preheat oven to 350" ⏎ "F / 180 C"). A step ending in a bare number
 * (no closing punctuation) followed by a step starting with a unit token is
 * one sentence broken across a line break, not two steps.
 */
export function joinBrokenUnitSteps(
	steps: Array<{ content: string }>,
): Array<{ content: string }> {
	const result: Array<{ content: string }> = []
	for (const step of steps) {
		const prev = result[result.length - 1]
		if (
			prev &&
			STEP_TRAILING_NUMBER.test(prev.content) &&
			STEP_LEADING_UNIT.test(step.content)
		) {
			prev.content = `${prev.content} ${step.content}`
		} else {
			result.push({ ...step })
		}
	}
	return result
}

/**
 * Split a block of text into multiple recipes separated by `---` lines.
 * A single recipe (no separator) returns an array of length 1.
 */
export function splitMultipleRecipes(text: string): string[] {
	return text
		.split(/^\s*---\s*$/m)
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * Normalize common Unicode characters and strip Markdown formatting
 * that Apple Notes and other rich-text editors introduce.
 */
function normalizeText(text: string): string {
	return (
		text
			// Smart quotes → straight quotes
			.replace(/[\u2018\u2019]/g, "'")
			.replace(/[\u201C\u201D]/g, '"')
			// Non-breaking spaces → regular spaces
			.replace(/\u00A0/g, ' ')
			// Zero-width spaces and joiners
			.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
			// Apple Notes links: ++[text](url)++ → text
			.replace(/\+\+\[([^\]]+)\]\([^)]+\)\+\+/g, '$1')
			// Markdown escaped characters: \* \_ \# → literal
			.replace(/\\([*_#])/g, '$1')
			// Markdown heading prefixes: # Title → Title
			.replace(/^#{1,6}\s+/gm, '')
			// Markdown bold/italic: ** and *** (preserve single * for bullet detection)
			.replace(/\*{2,}/g, '')
			// Markdown underscore italic markers
			.replace(/_/g, '')
			// Join continuation lines: indented non-bullet lines rejoin previous line
			.replace(/\n[ \t]{2,}(?=\S)(?![-*•]\s)(?!\d+[.)]\s)(?!\[[ x]\])/g, ' ')
			// Split inline bullet separators: "flour • sugar" → separate lines
			.replace(/(\S)\s+•\s+/g, '$1\n• ')
	)
}

/**
 * Strip bullet/number prefixes from a line.
 * Handles: "- ", "* ", "• ", "1. ", "1) ", "1 ", numbered with parens, etc.
 */
function stripBullet(line: string): string {
	return line
		.replace(/^\s*[-*•]\s+/, '')
		.replace(/^\s*\[[ x]\]\s*/, '') // strip checkbox markers
		.replace(/^\s*\d+[.)]\s+/, '')
		.trim()
}

/**
 * Check if a line starts with a bullet, checkbox, or number prefix.
 * Used to distinguish ingredient lines from sub-section headers.
 */
function hasBulletPrefix(line: string): boolean {
	const trimmed = line.trim()
	return /^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)
}

/**
 * Parse a single recipe from plain text.
 *
 * Expected format:
 *   Title
 *   (optional description lines)
 *   Ingredients
 *   - item 1
 *   - item 2
 *   Instructions
 *   1. step 1
 *   2. step 2
 */
export function parseRecipeText(text: string): ParsedRecipe {
	const normalized = normalizeText(text)
	const lines = normalized.split('\n')
	const warnings: string[] = []

	// Identify heading positions
	type Section = {
		type: 'ingredients' | 'instructions'
		startIndex: number
	}
	const sections: Section[] = []

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]!.trim()
		const match = trimmed.match(HEADING_PATTERN)
		if (match) {
			const heading = match[1]!.toLowerCase()
			if (heading === 'ingredients') {
				sections.push({ type: 'ingredients', startIndex: i })
			} else {
				// directions, steps, method, preparation, instructions → all map to instructions
				sections.push({ type: 'instructions', startIndex: i })
			}
		}
	}

	// Title: first non-empty line before any heading
	const firstHeadingIndex =
		sections.length > 0 ? sections[0]!.startIndex : lines.length
	let title = ''
	let titleIndex = -1
	for (let i = 0; i < firstHeadingIndex; i++) {
		const trimmed = lines[i]!.trim()
		if (trimmed) {
			title = trimmed
			titleIndex = i
			break
		}
	}

	if (!title) {
		warnings.push('No title found')
	}

	// "Pho (Serves 2)" → title "Pho", typed yield "2 servings".
	let yieldAmount: number | undefined
	let yieldLabel: string | undefined
	if (title) {
		const extracted = extractYieldFromTitle(title)
		if (extracted.yieldAmount !== null && extracted.yieldLabel !== null) {
			title = extracted.title
			yieldAmount = extracted.yieldAmount
			yieldLabel = extracted.yieldLabel
		}
	}

	// Description: non-empty lines between title and first heading.
	// Standalone "Serves 4" lines are metadata, not description.
	let description: string | undefined
	if (titleIndex >= 0 && firstHeadingIndex > titleIndex + 1) {
		const descLines: string[] = []
		for (let i = titleIndex + 1; i < firstHeadingIndex; i++) {
			const trimmed = lines[i]!.trim()
			if (!trimmed) continue
			const typedYield = matchTypedYieldLine(trimmed)
			if (typedYield !== null) {
				yieldAmount ??= typedYield.amount
				yieldLabel ??= typedYield.label
				continue
			}
			descLines.push(trimmed)
		}
		if (descLines.length > 0) {
			description = descLines.join(' ')
		}
	}

	// Extract section content
	function getSectionLines(sectionIndex: number): string[] {
		const section = sections[sectionIndex]!
		const start = section.startIndex + 1
		const end =
			sectionIndex + 1 < sections.length
				? sections[sectionIndex + 1]!.startIndex
				: lines.length
		const result: string[] = []
		for (let i = start; i < end; i++) {
			const trimmed = lines[i]!.trim()
			if (trimmed) {
				result.push(trimmed)
			}
		}
		return result
	}

	// Parse ingredients
	const ingredients: ParsedRecipe['ingredients'] = []
	const ingredientSectionIndex = sections.findIndex(
		(s) => s.type === 'ingredients',
	)
	if (ingredientSectionIndex >= 0) {
		const ingredientLines = getSectionLines(ingredientSectionIndex)
		const usesBullets = ingredientLines.some(hasBulletPrefix)
		// When the whole list is caps, caps is house style, not structure
		const allCapsIsHeading = !isAllCapsHouseStyle(
			ingredientLines.map(stripBullet),
		)
		let currentHeading: string | undefined

		for (const line of ingredientLines) {
			// "Serves 4" inside the ingredient list is metadata, not an ingredient
			const typedYield = matchTypedYieldLine(stripBullet(line))
			if (typedYield !== null) {
				yieldAmount ??= typedYield.amount
				yieldLabel ??= typedYield.label
				continue
			}

			// In bulleted sections, non-bulleted lines are sub-headers
			if (usesBullets && !hasBulletPrefix(line)) {
				const heading =
					detectIngredientHeading(line, { allCapsIsHeading }) ??
					line.replace(/:$/, '').trim()
				if (heading) {
					currentHeading = heading
					ingredients.push({ name: heading, isHeading: true })
				}
				continue
			}

			const stripped = stripBullet(line)
			if (!stripped) continue

			// Heading-ish lines ("For the crust:", "PIE DOUGH") become headings
			// even when the source bullets them like ingredients
			const heading = detectIngredientHeading(stripped, { allCapsIsHeading })
			if (heading) {
				currentHeading = heading
				ingredients.push({ name: heading, isHeading: true })
				continue
			}

			// Skip lines that are clearly not ingredients (paragraph-length text)
			if (stripped.length > 200) {
				warnings.push(
					`Skipped long line (not an ingredient): "${stripped.slice(0, 60)}..."`,
				)
				continue
			}
			const parsed = parseIngredient(stripped)
			if (parsed) {
				// Carry sub-section context into ingredient notes
				if (currentHeading) {
					const headingNote = /^for\b/i.test(currentHeading)
						? currentHeading
						: `for ${currentHeading}`
					parsed.notes = parsed.notes
						? `${parsed.notes}, ${headingNote}`
						: headingNote
				}
				ingredients.push(parsed)
			}
		}
	}

	if (ingredients.length === 0) {
		warnings.push('No ingredients found')
	}

	// Parse instructions
	const instructions: ParsedRecipe['instructions'] = []
	const instructionSectionIndex = sections.findIndex(
		(s) => s.type === 'instructions',
	)
	if (instructionSectionIndex >= 0) {
		const instructionLines = getSectionLines(instructionSectionIndex)
		for (const line of instructionLines) {
			const stripped = stripBullet(line)
			if (stripped) {
				instructions.push({ content: stripped })
			}
		}
	}

	const joinedInstructions = joinBrokenUnitSteps(instructions)
	if (joinedInstructions.length < instructions.length) {
		warnings.push('Joined steps that were split mid-measurement')
	}

	if (joinedInstructions.length === 0) {
		warnings.push('No instructions found')
	}

	return {
		title,
		description,
		yieldAmount,
		yieldLabel,
		ingredients,
		instructions: joinedInstructions,
		warnings,
	}
}
