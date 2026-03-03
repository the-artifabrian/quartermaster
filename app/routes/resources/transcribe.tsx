import { parseFormData, type FileUpload } from '@mjackson/form-data-parser'
import { data } from 'react-router'
import { type ParsedItem } from '#app/utils/parse-speech-item.ts'
import { requireProTier } from '#app/utils/subscription.server.ts'
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

export async function action({ request }: Route.ActionArgs) {
	await requireProTier(request)

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

	const result = await transcribeAudio(audioFile)

	if ('error' in result) {
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
