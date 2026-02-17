import { parseIngredient } from './ingredient-parser.ts'

export type ParsedRecipe = {
	title: string
	description?: string
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

	// Description: non-empty lines between title and first heading
	let description: string | undefined
	if (titleIndex >= 0 && firstHeadingIndex > titleIndex + 1) {
		const descLines: string[] = []
		for (let i = titleIndex + 1; i < firstHeadingIndex; i++) {
			const trimmed = lines[i]!.trim()
			if (trimmed) {
				descLines.push(trimmed)
			}
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

		for (const line of ingredientLines) {
			// In bulleted sections, non-bulleted lines are sub-headers
			if (usesBullets && !hasBulletPrefix(line)) {
				const heading = line.replace(/:$/, '').trim()
				if (heading) {
					ingredients.push({ name: heading, isHeading: true })
				}
				continue
			}

			const stripped = stripBullet(line)
			if (!stripped) continue
			// Skip lines that are clearly not ingredients (paragraph-length text)
			if (stripped.length > 200) {
				warnings.push(
					`Skipped long line (not an ingredient): "${stripped.slice(0, 60)}..."`,
				)
				continue
			}
			const parsed = parseIngredient(stripped)
			if (parsed) {
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

	if (instructions.length === 0) {
		warnings.push('No instructions found')
	}

	return {
		title,
		description,
		ingredients,
		instructions,
		warnings,
	}
}
