import { type FileUpload } from '@mjackson/form-data-parser'
import { parseSpeechItems, type ParsedItem } from './parse-speech-item.ts'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3-turbo'
const TIMEOUT_MS = 15_000

type TranscribeResult = {
	transcription: string
	items: ParsedItem[]
}

export async function transcribeAudio(
	audioFile: FileUpload,
): Promise<TranscribeResult | { error: string }> {
	const apiKey = process.env.GROQ_API_KEY
	if (!apiKey) {
		return { error: 'Voice input is not configured. Contact support.' }
	}

	try {
		const formData = new FormData()
		formData.append(
			'file',
			new File([await audioFile.arrayBuffer()], audioFile.name || 'audio.webm', {
				type: audioFile.type,
			}),
		)
		formData.append('model', MODEL)
		formData.append('language', 'en')
		formData.append(
			'prompt',
			'Grocery shopping list items, food ingredients, cooking supplies.',
		)

		const response = await fetch(GROQ_API_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}` },
			body: formData,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})

		if (!response.ok) {
			console.error(
				`Whisper transcription error: ${response.status} ${response.statusText}`,
			)
			if (response.status === 429) {
				return {
					error: 'Voice input hit a rate limit. Please wait a moment and try again.',
				}
			}
			return {
				error: 'Voice transcription failed. Please try again.',
			}
		}

		const data = (await response.json()) as { text?: string }
		const transcription = data.text?.trim() ?? ''

		if (!transcription) {
			return { error: "Couldn't understand the audio. Please try again." }
		}

		const items = parseSpeechItems(transcription)

		if (items.length === 0) {
			return { error: "Couldn't understand the audio. Please try again." }
		}

		return { transcription, items }
	} catch (error) {
		console.error('Whisper transcription error:', error)
		if (error instanceof DOMException && error.name === 'TimeoutError') {
			return { error: 'Voice transcription timed out. Please try again.' }
		}
		return {
			error: 'Voice transcription failed. Please try again.',
		}
	}
}
