const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 15_000
const MAX_INVENTORY_ITEMS = 80
const MAX_INGREDIENTS = 50
const MAX_INSTRUCTIONS = 30

export type GeneratedRecipe = {
	title: string
	description: string
	servings: number
	prepTime: number | null
	cookTime: number | null
	ingredients: Array<{
		name: string
		amount: string | null
		unit: string | null
		notes: string | null
	}>
	instructions: Array<{ content: string }>
	suggestedTags: string[]
}

export type GenerationPreferences = {
	mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
	quickMeal?: boolean // ≤30 min total time
}

export type InventoryInput = {
	name: string
	quantity: number | null
	unit: string | null
	location: string
	expiresAt: Date | null
}

/**
 * Call Claude Haiku to generate a recipe from inventory items.
 *
 * Returns null if:
 * - No API key is configured
 * - The API call fails or times out
 * - The response can't be parsed
 */
export async function generateRecipeFromInventory(
	inventory: InventoryInput[],
	preferences?: GenerationPreferences,
): Promise<GeneratedRecipe | null> {
	const apiKey = process.env.ANTHROPIC_API_KEY
	if (!apiKey) return null

	try {
		const response = await fetch(ANTHROPIC_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: MODEL,
				max_tokens: 2048,
				system:
					'You are a practical home cook. Create a recipe using ONLY the ingredients provided. Return only valid JSON — no markdown, no explanation.',
				messages: [
					{
						role: 'user',
						content: buildPrompt(inventory, preferences),
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Recipe generation LLM error: ${response.status} ${response.statusText}`,
			)
			return null
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) return null

		return parseRecipeResponse(text)
	} catch (error) {
		console.error('Recipe generation LLM error:', error)
		return null
	}
}

export function buildPrompt(
	inventory: InventoryInput[],
	preferences?: GenerationPreferences,
): string {
	const now = new Date()

	// Sort: expiring items first, then by location
	const sorted = [...inventory]
		.sort((a, b) => {
			const aExpiring =
				a.expiresAt &&
				a.expiresAt >= now &&
				a.expiresAt.getTime() - now.getTime() < 3 * 86400000
			const bExpiring =
				b.expiresAt &&
				b.expiresAt >= now &&
				b.expiresAt.getTime() - now.getTime() < 3 * 86400000
			if (aExpiring && !bExpiring) return -1
			if (!aExpiring && bExpiring) return 1
			return a.location.localeCompare(b.location)
		})
		.slice(0, MAX_INVENTORY_ITEMS)

	const inventoryLines = sorted.map((item) => {
		const parts = [item.name]
		if (item.quantity && item.unit) {
			parts.push(`(${item.quantity} ${item.unit})`)
		} else if (item.quantity) {
			parts.push(`(${item.quantity})`)
		}
		parts.push(`[${item.location}]`)
		if (
			item.expiresAt &&
			item.expiresAt >= now &&
			item.expiresAt.getTime() - now.getTime() < 3 * 86400000
		) {
			parts.push('[EXPIRING SOON]')
		}
		return parts.join(' ')
	})

	const prefLines: string[] = []
	if (preferences?.mealType) {
		prefLines.push(`- Meal type: ${preferences.mealType}`)
	}
	if (preferences?.quickMeal) {
		prefLines.push('- Quick meal: total time must be 30 minutes or less')
	}

	return `Create a recipe from my available ingredients.

My inventory:
${inventoryLines.join('\n')}

${prefLines.length > 0 ? `Preferences:\n${prefLines.join('\n')}\n` : ''}Return a single JSON object with this exact structure:
{
  "title": "Recipe Name",
  "description": "Brief appetizing description (1-2 sentences)",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 30,
  "ingredients": [
    {"name": "ingredient name", "amount": "2", "unit": "cups", "notes": "diced"}
  ],
  "instructions": [
    {"content": "Step description"}
  ],
  "suggestedTags": ["dinner", "italian"]
}

Rules:
- Use ONLY ingredients from my inventory list above, plus common pantry staples (salt, pepper, oil, water, basic spices)
- Prioritize items marked [EXPIRING SOON]
- Use specific amounts and units for each ingredient
- Write clear, beginner-friendly instructions
- prepTime and cookTime are in minutes (use null if unknown)
- suggestedTags should be lowercase and match common categories: cuisine names (italian, mexican, asian, etc.), meal types (breakfast, lunch, dinner, snack), or dietary labels (vegetarian, vegan, gluten-free, etc.)
- Create a complete, practical, everyday recipe — not overly fancy`
}

/**
 * Parse and validate the LLM response.
 * Extracts JSON from the response text, validates structure.
 */
export function parseRecipeResponse(text: string): GeneratedRecipe | null {
	try {
		// Extract JSON object — handle markdown code blocks just in case
		const jsonMatch = text.match(/\{[\s\S]*\}/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
		if (typeof parsed !== 'object' || parsed === null) return null

		// Validate required fields
		if (typeof parsed.title !== 'string' || !parsed.title.trim()) return null

		const recipe: GeneratedRecipe = {
			title: parsed.title.trim(),
			description:
				typeof parsed.description === 'string'
					? parsed.description.trim()
					: '',
			servings:
				typeof parsed.servings === 'number' && parsed.servings > 0
					? Math.min(parsed.servings, 100)
					: 4,
			prepTime:
				typeof parsed.prepTime === 'number' && parsed.prepTime >= 0
					? parsed.prepTime
					: null,
			cookTime:
				typeof parsed.cookTime === 'number' && parsed.cookTime >= 0
					? parsed.cookTime
					: null,
			ingredients: [],
			instructions: [],
			suggestedTags: [],
		}

		// Parse ingredients
		if (Array.isArray(parsed.ingredients)) {
			for (const item of parsed.ingredients.slice(0, MAX_INGREDIENTS)) {
				if (
					typeof item !== 'object' ||
					item === null ||
					typeof (item as { name?: unknown }).name !== 'string'
				) {
					continue
				}
				const ing = item as Record<string, unknown>
				recipe.ingredients.push({
					name: (ing.name as string).trim(),
					amount:
						typeof ing.amount === 'string'
							? ing.amount.trim() || null
							: typeof ing.amount === 'number'
								? String(ing.amount)
								: null,
					unit: typeof ing.unit === 'string' ? ing.unit.trim() || null : null,
					notes:
						typeof ing.notes === 'string' ? ing.notes.trim() || null : null,
				})
			}
		}

		// Parse instructions
		if (Array.isArray(parsed.instructions)) {
			for (const item of parsed.instructions.slice(0, MAX_INSTRUCTIONS)) {
				if (typeof item === 'string') {
					const trimmed = item.trim()
					if (trimmed) recipe.instructions.push({ content: trimmed })
				} else if (
					typeof item === 'object' &&
					item !== null &&
					typeof (item as { content?: unknown }).content === 'string'
				) {
					const content = ((item as { content: string }).content || '').trim()
					if (content) recipe.instructions.push({ content })
				}
			}
		}

		// Parse suggested tags
		if (Array.isArray(parsed.suggestedTags)) {
			for (const tag of parsed.suggestedTags.slice(0, 10)) {
				if (typeof tag === 'string' && tag.trim()) {
					recipe.suggestedTags.push(tag.trim().toLowerCase())
				}
			}
		}

		// Must have at least one ingredient and one instruction
		if (recipe.ingredients.length === 0 || recipe.instructions.length === 0) {
			return null
		}

		return recipe
	} catch {
		return null
	}
}
