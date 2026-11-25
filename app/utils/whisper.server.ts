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
 * A failed transcription. `refundable` says whether the caller should give
 * back the daily use. It does when the failure is ours or Groq's and the user
 * can't cause it: no key, a dropped connection, or Groq answering 401, 403,
 * 404, 429 or 5xx. A timeout stays spent, since Groq may have finished after
 * we stopped waiting. So does another 4xx, which is about the audio we sent,
 * and anything after a 200.
 */
type TranscribeFailure = { error: string; refundable: boolean }

/** 401, 403 and 404 mean our key or model is wrong; 5xx is Groq's own. */
function isRefundableStatus(status: number) {
	return status === 401 || status === 403 || status === 404 || status >= 500
}

const FAILED = 'We couldn’t turn that into text. Try again.'
const NOT_UNDERSTOOD = 'We couldn’t make out what you said. Try again.'

export async function transcribeAudio(
	audioFile: FileUpload,
): Promise<TranscribeResult | TranscribeFailure> {
	const apiKey = process.env.GROQ_API_KEY
	if (!apiKey) {
		return {
			error: 'Voice input isn’t set up on this server. Type the items instead.',
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
				error: 'That took too long to turn into text. Try again.',
				refundable: false,
			}
		}
		// No response arrived. Groq may still have had the request, but a user
		// can't cause a dropped connection, so the use comes back.
		return { error: FAILED, refundable: true }
	}

	if (!response.ok) {
		console.error(
			`Whisper transcription error: ${response.status} ${response.statusText}`,
		)
		if (response.status === 429) {
			return {
				error: 'Too many voice requests at once. Wait a moment and try again.',
				refundable: true,
			}
		}
		return {
			error: FAILED,
			refundable: isRefundableStatus(response.status),
		}
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
