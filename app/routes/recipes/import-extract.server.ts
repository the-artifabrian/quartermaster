import { type FileUpload } from '@mjackson/form-data-parser'
import {
	aiUsageLimitsFor,
	aiUsageRefusal,
	claimAiUsage,
} from '#app/utils/ai-rate-limit.server.ts'
import {
	importFailure,
	saveImportedRecipe,
} from '#app/utils/import-recipe-save.server.ts'
import { type ExtractedRecipe } from '#app/utils/import-recipe-types.ts'
import { isNativeShell } from '#app/utils/native-shell.server.ts'
import { AI_FEATURE_USED } from '#app/utils/posthog-events.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import {
	ALLOWED_IMAGE_MEDIA_TYPES,
	extractRecipeFromImages,
	extractRecipeFromText,
	type RecipeMetadataVocabulary,
} from '#app/utils/recipe-extract-llm.server.ts'
import {
	recipeMetadataOptions,
	type RecipeMetadataOptionRow,
} from '#app/utils/recipe-metadata.server.ts'
import {
	emptyRecipeMetadataGroups,
	groupRecipeMetadataValues,
	RECIPE_METADATA_DIMENSIONS,
	recipeMetadataIdentity,
	recipeMetadataNameKey,
} from '#app/utils/recipe-metadata.ts'
import {
	MAX_IMPORT_IMAGE_COUNT,
	MAX_IMPORT_IMAGE_SIZE,
	MAX_RAW_TEXT_LENGTH,
} from '#app/utils/recipe-validation.ts'
import {
	isTooBigToDecode,
	sniffImageType,
} from '#app/utils/recipe-photo.server.ts'

export const MAX_IMAGE_SIZE = MAX_IMPORT_IMAGE_SIZE
export const MAX_IMAGE_COUNT = MAX_IMPORT_IMAGE_COUNT
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** The names the extraction may choose from, per dimension. */
function metadataVocabulary(
	values: RecipeMetadataOptionRow[],
): RecipeMetadataVocabulary {
	const grouped = groupRecipeMetadataValues(values)
	const vocabulary = emptyRecipeMetadataGroups<string>()
	for (const dimension of RECIPE_METADATA_DIMENSIONS) {
		vocabulary[dimension] = grouped[dimension].map((value) => value.name)
	}
	return vocabulary
}

/**
 * The household rows behind the names the extraction matched. A matched name
 * is one the household already has, so this only looks rows up — it never
 * creates one, and a name it cannot place is simply not ticked.
 */
function matchedValueIds(
	values: RecipeMetadataOptionRow[],
	matched: RecipeMetadataVocabulary,
) {
	const grouped = groupRecipeMetadataValues(values)
	const idsByIdentity = new Map(
		RECIPE_METADATA_DIMENSIONS.flatMap((dimension) =>
			grouped[dimension].map(
				(value) =>
					[recipeMetadataIdentity(dimension, value.nameKey), value.id] as const,
			),
		),
	)
	return RECIPE_METADATA_DIMENSIONS.flatMap((dimension) =>
		matched[dimension].flatMap((name) => {
			const id = idsByIdentity.get(
				recipeMetadataIdentity(dimension, recipeMetadataNameKey(name)),
			)
			return id ? [id] : []
		}),
	)
}

/** Whether the image's header says it costs more to decode than a photo may. */
async function isTooBigToRead(buffer: ArrayBuffer) {
	const { default: sharp } = await import('sharp')
	// The header alone, so no limit is needed to read it.
	const metadata = await sharp(buffer, { limitInputPixels: false })
		.metadata()
		.catch(() => null)
	return metadata !== null && isTooBigToDecode(metadata)
}

/**
 * The `extract-text` and `extract-image` intents: a Pro user's text or
 * screenshots, read by the AI extraction and saved.
 */
export async function importWithAi(
	formData: FormData,
	intentKey: 'extract-text' | 'extract-image',
	{
		userId,
		householdId,
		isProActive,
		request,
		imageFiles,
	}: {
		userId: string
		householdId: string
		isProActive: boolean
		request: Request
		imageFiles: FileUpload[]
	},
) {
	if (!isProActive) {
		return importFailure(
			intentKey,
			// The iOS app shows no copy about Pro (ADR 0001).
			isNativeShell(request)
				? 'AI extraction is not available.'
				: 'AI extraction requires a Pro subscription.',
			403,
		)
	}

	const rawText = (formData.get('rawText') as string) || ''

	if (intentKey === 'extract-text' && !rawText.trim()) {
		return importFailure(intentKey, 'Please paste some recipe text.')
	}

	if (intentKey === 'extract-image' && imageFiles.length === 0) {
		return importFailure(intentKey, 'Please upload at least one image.')
	}

	if (rawText.length > MAX_RAW_TEXT_LENGTH) {
		return importFailure(
			intentKey,
			'Text is too long. Please shorten it and try again.',
		)
	}

	// The images are checked before the claim, so a bad file spends nothing.
	const validatedImages: Array<{ base64: string; mediaType: string }> = []
	if (intentKey === 'extract-image') {
		for (const file of imageFiles) {
			const buffer = await file.arrayBuffer()

			// Re-check actual buffer size (stream-level check may use client-reported size)
			if (buffer.byteLength > MAX_IMAGE_SIZE) {
				return importFailure(
					intentKey,
					'One or more images are too large. Maximum size is 5MB each.',
				)
			}

			// Validate magic bytes — don't trust client-provided Content-Type
			const detectedType = sniffImageType(new Uint8Array(buffer))
			if (
				!detectedType ||
				!ALLOWED_IMAGE_MEDIA_TYPES.includes(
					detectedType as (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number],
				)
			) {
				return importFailure(
					intentKey,
					'We can’t use one of the images. Choose a JPG, PNG or WebP.',
				)
			}

			// The header alone gives the size, so an oversized image is
			// refused before it spends a use or gets decoded. A header sharp
			// can't read is left for the extraction to refuse, as before.
			if (await isTooBigToRead(buffer)) {
				return importFailure(
					intentKey,
					'One of the images is too big to read. Try a smaller one.',
				)
			}

			validatedImages.push({
				base64: Buffer.from(buffer).toString('base64'),
				mediaType: detectedType,
			})
		}
	}

	const metadataValues = await recipeMetadataOptions(householdId)
	const vocabulary = metadataVocabulary(metadataValues)

	const limits = await aiUsageLimitsFor(userId, 'recipe_extract_llm_call')
	const usage = await claimAiUsage(userId, 'recipe_extract_llm_call', limits)
	if (!usage.allowed) {
		const refusal = aiUsageRefusal(usage.reason, {
			limits,
			uses: 'AI imports',
			keepGoing: 'keep importing',
			unavailable: "Couldn't start the import just now.",
		})
		return importFailure(intentKey, refusal.error, refusal.status)
	}

	let llmResult: Awaited<ReturnType<typeof extractRecipeFromText>>
	let durationMs: number

	if (intentKey === 'extract-image') {
		const startedAt = performance.now()
		llmResult = await extractRecipeFromImages(validatedImages, vocabulary)
		durationMs = Math.round(performance.now() - startedAt)
	} else {
		const startedAt = performance.now()
		llmResult = await extractRecipeFromText(rawText, vocabulary)
		durationMs = Math.round(performance.now() - startedAt)
	}

	if ('error' in llmResult) {
		if (llmResult.refundable) await usage.refund()
		return importFailure(intentKey, llmResult.error, 422)
	}

	const recipe: ExtractedRecipe = {
		title: llmResult.title,
		description: llmResult.description,
		notes: llmResult.notes,
		activeTime: llmResult.activeTime,
		totalTime: llmResult.totalTime,
		yieldAmount: llmResult.yieldAmount,
		yieldLabel: llmResult.yieldLabel,
		sourceUrl: '',
		metadataValueIds: matchedValueIds(metadataValues, llmResult.metadata),
		rawText: (intentKey === 'extract-text'
			? rawText
			: JSON.stringify(llmResult, null, 2)
		).slice(0, MAX_RAW_TEXT_LENGTH),
		ingredients: llmResult.ingredients.map((ing) => ({
			name: ing.name,
			amount: ing.amount ?? undefined,
			unit: ing.unit ?? undefined,
			notes: ing.notes ?? undefined,
			isHeading: ing.isHeading,
		})),
		instructions: llmResult.instructions,
	}

	captureServerEvent(userId, AI_FEATURE_USED, {
		feature: 'recipe_extract',
		source: intentKey === 'extract-image' ? 'image' : 'text',
		...(intentKey === 'extract-image' && {
			image_count: imageFiles.length,
		}),
		// Wall time of the model call, image preparation included, to compare
		// models in PostHog.
		duration_ms: durationMs,
	})

	return saveImportedRecipe(recipe, intentKey, { userId, householdId })
}
