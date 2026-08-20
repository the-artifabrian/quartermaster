import { z } from 'zod'
import {
	ANTHROPIC_MODELS,
	requestAnthropicJson,
} from './anthropic-json.server.ts'
import { type ParsedItem } from './parse-speech-item.ts'

const TIMEOUT_MS = 4_000
const MAX_ITEMS = 50

const SpeechItemSchema = z
	.object({
		name: z.string(),
		quantity: z.unknown().optional(),
		unit: z.unknown().optional(),
	})
	.transform((item) => ({
		name: item.name.trim().toLowerCase(),
		quantity:
			typeof item.quantity === 'number'
				? String(item.quantity)
				: typeof item.quantity === 'string'
					? item.quantity.trim()
					: '',
		unit: typeof item.unit === 'string' ? item.unit.trim().toLowerCase() : '',
	}))
	.refine((item) => Boolean(item.name))

const SpeechItemsSchema: z.ZodType<ParsedItem[]> = z
	.array(z.unknown())
	.transform((items) =>
		items.slice(0, MAX_ITEMS).flatMap((item) => {
			const parsed = SpeechItemSchema.safeParse(item)
			return parsed.success ? [parsed.data] : []
		}),
	)

/**
 * Parse a speech transcript into structured grocery items using Claude Haiku.
 *
 * Returns `ParsedItem[]` on success, or `null` on any failure so the caller
 * can fall back to the regex parser.
 */
export async function parseSpeechItemsWithLLM(
	transcript: string,
): Promise<ParsedItem[] | null> {
	const result = await requestAnthropicJson({
		feature: 'speech-parse',
		model: ANTHROPIC_MODELS.fast,
		maxTokens: 512,
		timeoutMs: TIMEOUT_MS,
		system: `You are a grocery list parser that extracts items from speech-to-text transcripts.
Return ONLY a valid JSON array — no markdown fences, no explanation.

CRITICAL: Speech-to-text often produces garbage, hallucinated, or nonsensical output.
If the transcript is gibberish, unintelligible, or does not contain any recognizable grocery/food items, return an empty array: []
Do NOT invent or guess items that aren't clearly present in the transcript.`,
		prompt: buildPrompt(transcript),
		schema: SpeechItemsSchema,
	})

	return result.ok ? result.data : null
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
- IMPORTANT: Speech-to-text often garbles grocery item names. Always correct to the real grocery item name, even if the transcription looks like a real word (e.g. "cardone" → "cardamom", "paprica" → "paprika", "tumeric" → "turmeric", "saleninuta" → "slăninuță", "pasta de fasole" → "păstăi de fasole"). Use your knowledge of common grocery items to fix these.
- Keep item names in the original language of the transcript
- Normalize units to the canonical list above (e.g. "pounds" → "lb", "ounces" → "oz")
- If quantity is not mentioned, use ""
- If unit is not mentioned or not in the list, use ""
- For quantity ranges like "2-3", pick the higher number`
}
