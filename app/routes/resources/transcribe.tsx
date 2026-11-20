import { parseFormData, type FileUpload } from '@mjackson/form-data-parser'
import { data } from 'react-router'
import {
	aiUsageRefusal,
	claimAiUsage,
} from '#app/utils/ai-rate-limit.server.ts'
import { type ParsedItem } from '#app/utils/parse-speech-item.ts'
import { requireProTierOrNativeShellNull } from '#app/utils/subscription.server.ts'
import { transcribeAudio } from '#app/utils/whisper.server.ts'
import { type Route } from './+types/transcribe.ts'

const MAX_AUDIO_SIZE = 5 * 1024 * 1024 // 5 MB
const ACCEPTED_AUDIO_TYPES = [
	'audio/webm',
	'audio/mp4',
	'audio/wav',
	'audio/mpeg',
	'audio/ogg',
]

// Each use is one Whisper clip plus one small Haiku call, a fraction of a
// cent. Thirty covers a big weekly shop said one item at a time, retries
// included, so nobody using the app for real should hit it. It caps what one
// account can spend in a day, and every new signup gets a Pro trial.
const DAILY_LIMIT = 30

export async function action({ request }: Route.ActionArgs) {
	const proTier = await requireProTierOrNativeShellNull(request)
	if (!proTier) {
		return data(
			{
				error: 'Voice input is not available.',
				items: [] as ParsedItem[],
				transcription: null as string | null,
			},
			{ status: 403 },
		)
	}

	let audioFile: FileUpload | null = null

	const formData = await parseFormData(
		request,
		{ maxFileSize: MAX_AUDIO_SIZE },
		async (file) => {
			if (file.fieldName === 'audio') {
				if (file.size > MAX_AUDIO_SIZE) {
					return undefined
				}
				if (!ACCEPTED_AUDIO_TYPES.some((t) => file.type.startsWith(t))) {
					return undefined
				}
				audioFile = file
				return file
			}
			return undefined
		},
	)

	void formData // consumed for side-effect of parsing the audio file

	if (!audioFile) {
		return data(
			{
				error: 'No audio file provided',
				items: [] as ParsedItem[],
				transcription: null as string | null,
			},
			{ status: 400 },
		)
	}

	const usage = await claimAiUsage(proTier.userId, 'voice_transcribe_call', {
		perUser: DAILY_LIMIT,
	})
	if (!usage.allowed) {
		const refusal = aiUsageRefusal(usage.reason, {
			limit: DAILY_LIMIT,
			uses: 'voice entries',
		})
		return data(
			{
				error: refusal.error,
				items: [] as ParsedItem[],
				transcription: null as string | null,
			},
			{ status: refusal.status },
		)
	}

	const result = await transcribeAudio(audioFile)

	if ('error' in result) {
		if (result.refundable) await usage.refund()
		return data(
			{
				error: result.error,
				items: [] as ParsedItem[],
				transcription: null as string | null,
			},
			{ status: 422 },
		)
	}

	return data({
		error: null,
		items: result.items,
		transcription: result.transcription,
	})
}
