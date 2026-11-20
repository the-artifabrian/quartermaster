import { type FileUpload } from '@mjackson/form-data-parser'
import { parseSpeechItems, type ParsedItem } from './parse-speech-item.ts'
import { parseSpeechItemsWithLLM } from './speech-parse-llm.server.ts'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const TIMEOUT_MS = 15_000

/**
 * Whisper hallucinates these phrases when given silence, noise, or very short
 * audio. They are never valid grocery items.
 */
/**
 * Whisper hallucinates these phrases when given silence, noise, or very short
 * audio. Checked as exact matches only to avoid false positives.
 */
const WHISPER_HALLUCINATION_EXACT = new Set([
	'thank you',
	'thank you.',
	'thanks',
	'thanks.',
	'thanks for watching',
	'subscribe',
	'like and subscribe',
	'please subscribe',
	'see you next time',
	'bye',
	'bye bye',
	'goodbye',
	'you',
	'the end',
	'subtitles by',
	'amara.org',
	'music',
	'applause',
	'silence',
])

function isWhisperHallucination(text: string): boolean {
	const normalized = text
		.toLowerCase()
		.replace(/[.,!?;:\s]+/g, ' ')
		.trim()

	// Too short to be a real grocery item
	if (normalized.length < 2) return true

	// Mostly non-letter characters (noise artifacts)
	const letterRatio =
		(normalized.match(/[a-zA-Z\u00C0-\u024F]/g)?.length ?? 0) /
		normalized.length
	if (letterRatio < 0.5) return true

	// Known hallucination phrases (exact match only)
	return WHISPER_HALLUCINATION_EXACT.has(normalized)
}

type TranscribeResult = {
	transcription: string
	items: ParsedItem[]
}

/**
 * A failed transcription. `refundable` is true only when Groq cannot have
 * billed the call, so the caller can give back the daily use: no request went
 * out, none got a response, or Groq answered 429 or 5xx. A timeout stays
 * spent, since Groq may have finished after we stopped waiting, and so does
 * anything after a 200.
 */
type TranscribeFailure = { error: string; refundable: boolean }

const FAILED = 'Voice transcription failed. Please try again.'
const NOT_UNDERSTOOD = "Couldn't understand the audio. Please try again."

export async function transcribeAudio(
	audioFile: FileUpload,
): Promise<TranscribeResult | TranscribeFailure> {
	const apiKey = process.env.GROQ_API_KEY
	if (!apiKey) {
		return {
			error: 'Voice input is not configured. Contact support.',
			refundable: true,
		}
	}

	let response: Response
	try {
		const formData = new FormData()
		formData.append(
			'file',
			new File(
				[await audioFile.arrayBuffer()],
				audioFile.name || 'audio.webm',
				{
					type: audioFile.type,
				},
			),
		)
		formData.append('model', MODEL)
		formData.append(
			'prompt',
			'Grocery shopping list dictation. Items include fruits, vegetables, meat, dairy, bread, eggs, rice, pasta, spices, snacks, beverages, and household supplies. Quantities like pounds, ounces, bags, boxes, cans, bottles, and dozen are common. Items may be in English, Romanian, or other languages.',
		)

		response = await fetch(GROQ_API_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}` },
			body: formData,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
	} catch (error) {
		console.error('Whisper transcription error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return {
				error: 'Voice transcription timed out. Please try again.',
				refundable: false,
			}
		}
		// No response arrived, so nothing was billed.
		return { error: FAILED, refundable: true }
	}

	if (!response.ok) {
		console.error(
			`Whisper transcription error: ${response.status} ${response.statusText}`,
		)
		if (response.status === 429) {
			return {
				error:
					'Voice input hit a rate limit. Please wait a moment and try again.',
				refundable: true,
			}
		}
		// Another 4xx is about the audio we sent, which Groq may bill.
		return { error: FAILED, refundable: response.status >= 500 }
	}

	let transcription: string
	try {
		const data = (await response.json()) as { text?: string }
		transcription = data.text?.trim() ?? ''
	} catch (error) {
		console.error('Whisper transcription error:', error)
		return { error: FAILED, refundable: false }
	}

	if (!transcription) {
		return { error: NOT_UNDERSTOOD, refundable: false }
	}

	// Whisper makes up stock YouTube and podcast phrases when it gets mostly
	// silence or noise. Treat those as nothing heard.
	if (isWhisperHallucination(transcription)) {
		return { error: NOT_UNDERSTOOD, refundable: false }
	}

	// parseSpeechItemsWithLLM returns the items Haiku found (an empty list
	// when it found none), or null when the call failed, and then the regex
	// parser takes over.
	const llmResult = await parseSpeechItemsWithLLM(transcription)
	const items = llmResult ?? parseSpeechItems(transcription)

	if (items.length === 0) {
		return { error: NOT_UNDERSTOOD, refundable: false }
	}

	return { transcription, items }
}
