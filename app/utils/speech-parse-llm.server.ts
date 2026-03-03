import { type ParsedItem } from './parse-speech-item.ts'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 4_000
const MAX_ITEMS = 50

/**
 * Parse a speech transcript into structured grocery items using Claude Haiku.
 *
 * Returns `ParsedItem[]` on success, or `null` on any failure so the caller
 * can fall back to the regex parser.
 */
export async function parseSpeechItemsWithLLM(
	transcript: string,
): Promise<ParsedItem[] | null> {
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
				max_tokens: 512,
				system: `You are a grocery list parser that extracts items from speech-to-text transcripts.
Return ONLY a valid JSON array — no markdown fences, no explanation.

CRITICAL: Speech-to-text often produces garbage, hallucinated, or nonsensical output.
If the transcript is gibberish, unintelligible, or does not contain any recognizable grocery/food items, return an empty array: []
Do NOT invent or guess items that aren't clearly present in the transcript.`,
				messages: [
					{
						role: 'user',
						content: buildPrompt(transcript),
					},
				],
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Speech parse LLM error: ${response.status} ${response.statusText}`,
			)
			return null
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>
		}

		const text = data.content?.[0]?.text
		if (!text) return null

		return parseResponse(text)
	} catch (error) {
		console.error('Speech parse LLM error:', error)
		return null
	}
}

function buildPrompt(transcript: string): string {
	return `Extract grocery items from this spoken transcript:
"${transcript}"

Return a JSON array of objects with these fields:
- "name": item name (lowercase)
- "quantity": amount as a string (e.g. "2", "0.5"), or "" if not mentioned
- "unit": one of [lb, oz, g, kg, cup, tbsp, tsp, ml, l, pint, quart, gallon, bag, box, can, bottle, pack, package, dozen, each, piece, slice, loaf, head, clove, stalk, jar, carton, container, stick, bunch, roll, bar] or "" if not a known unit

Rules:
- If the transcript is gibberish, nonsensical, or contains no recognizable food/grocery items, return []
- Only include actual grocery/food items — ignore filler words, background noise artifacts, or non-food text
- Fix misspellings and missing diacritics from speech recognition (e.g. "saleninuta" → "slăninuță", "pasta de fasole" → "păstăi de fasole")
- Keep item names in the original language of the transcript
- Normalize units to the canonical list above (e.g. "pounds" → "lb", "ounces" → "oz")
- If quantity is not mentioned, use ""
- If unit is not mentioned or not in the list, use ""
- For quantity ranges like "2-3", pick the higher number`
}

/**
 * Parse and validate the LLM response.
 * Extracts a JSON array, validates each item, caps at MAX_ITEMS.
 */
function parseResponse(text: string): ParsedItem[] | null {
	try {
		const jsonMatch = text.match(/\[[\s\S]*\]/)
		if (!jsonMatch) return null

		const parsed = JSON.parse(jsonMatch[0]) as unknown[]
		if (!Array.isArray(parsed)) return null

		const items: ParsedItem[] = []
		for (const item of parsed.slice(0, MAX_ITEMS)) {
			if (
				typeof item !== 'object' ||
				item === null ||
				!('name' in item) ||
				typeof (item as { name: unknown }).name !== 'string'
			) {
				continue
			}

			const raw = item as Record<string, unknown>
			const name = (raw.name as string).trim().toLowerCase()
			if (!name) continue

			const quantity =
				typeof raw.quantity === 'number'
					? String(raw.quantity)
					: typeof raw.quantity === 'string'
						? raw.quantity.trim()
						: ''

			const unit =
				typeof raw.unit === 'string' ? raw.unit.trim().toLowerCase() : ''

			items.push({ name, quantity, unit })
		}

		return items
	} catch {
		return null
	}
}
