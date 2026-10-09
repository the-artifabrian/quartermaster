import {
	MaxFileSizeExceededError,
	parseFormData,
	type FileUpload,
} from '@mjackson/form-data-parser'
import { importFailure } from '#app/utils/import-recipe-save.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import {
	ACCEPTED_IMAGE_TYPES,
	importWithAi,
	MAX_IMAGE_COUNT,
	MAX_IMAGE_SIZE,
} from './import-extract.server.ts'
import { importFromUrl } from './import-fetch.server.ts'
import { importFromText } from './import-parse-text.server.ts'

/**
 * Reads the import form, with any screenshots, and hands it to its intent.
 * Every intent saves what it read and opens the new Recipe.
 */
export async function importAction(request: Request) {
	const { userId, householdId, isProActive } =
		await requireUserWithTier(request)

	const imageFiles: FileUpload[] = []
	let formData: FormData

	const contentType = request.headers.get('content-type') || ''
	if (contentType.includes('multipart/form-data')) {
		try {
			formData = await parseFormData(
				request,
				{ maxFileSize: MAX_IMAGE_SIZE },
				async (file) => {
					if (file.fieldName === 'image') {
						if (imageFiles.length >= MAX_IMAGE_COUNT) return undefined
						if (file.size > MAX_IMAGE_SIZE) return undefined
						if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return undefined
						imageFiles.push(file)
						return file
					}
					return undefined
				},
			)
		} catch (error) {
			if (!(error instanceof MaxFileSizeExceededError)) throw error
			return importFailure(
				'extract-image',
				'One or more images are too large. Maximum size is 5MB each.',
			)
		}
	} else {
		formData = await request.formData()
	}

	const intent = formData.get('intent')

	if (intent === 'fetch') {
		return importFromUrl(formData, { userId, householdId })
	}

	if (intent === 'parse-text') {
		return importFromText(formData, { userId, householdId })
	}

	if (intent === 'extract-text' || intent === 'extract-image') {
		return importWithAi(formData, intent, {
			userId,
			householdId,
			isProActive,
			request,
			imageFiles,
		})
	}

	return importFailure(null, 'Invalid action')
}
