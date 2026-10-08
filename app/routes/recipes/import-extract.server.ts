import { type FileUpload } from '@mjackson/form-data-parser'
import { data } from 'react-router'
import { checkAndRecordAiUsage } from '#app/utils/ai-rate-limit.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	type DuplicateMatch,
	type ExtractedRecipe,
} from '#app/utils/import-recipe-types.ts'
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
	MAX_IMPORT_IMAGE_SIZE,
	MAX_RAW_TEXT_LENGTH,
} from '#app/utils/recipe-validation.ts'

const DAILY_EXTRACT_LIMIT = 10
export const MAX_IMAGE_SIZE = MAX_IMPORT_IMAGE_SIZE
export const MAX_IMAGE_COUNT = 5
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

/**
 * Detect image media type from magic bytes.
 * Returns null if the bytes don't match any supported format.
 */
function detectImageMediaType(buffer: ArrayBuffer): string | null {
	if (buffer.byteLength < 12) return null
	const bytes = new Uint8Array(buffer, 0, 12)

	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg'
	}

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png'
	}

	// WebP: RIFF....WEBP
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp'
	}

	return null
}

/**
 * The `extract-text` and `extract-image` intents: a Pro user's text or
 * screenshots, read by the AI extraction.
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
		return data(
			{
				intent: intentKey,
				// The iOS app shows no copy about Pro (ADR 0001).
				error: isNativeShell(request)
					? 'AI extraction is not available.'
					: 'AI extraction requires a Pro subscription.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 403 },
		)
	}

	const rawText = (formData.get('rawText') as string) || ''

	if (intentKey === 'extract-text' && !rawText.trim()) {
		return data(
			{
				intent: intentKey,
				error: 'Please paste some recipe text.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	if (intentKey === 'extract-image' && imageFiles.length === 0) {
		return data(
			{
				intent: intentKey,
				error: 'Please upload at least one image.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	if (rawText.length > MAX_RAW_TEXT_LENGTH) {
		return data(
			{
				intent: intentKey,
				error: 'Text is too long. Please shorten it and try again.',
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 400 },
		)
	}

	const { allowed } = await checkAndRecordAiUsage(
		userId,
		'recipe_extract_llm_call',
		DAILY_EXTRACT_LIMIT,
	)
	if (!allowed) {
		return data(
			{
				intent: intentKey,
				error: `You've reached the daily limit of ${DAILY_EXTRACT_LIMIT} AI extractions. Try again tomorrow!`,
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 429 },
		)
	}

	const metadataValues = await recipeMetadataOptions(householdId)
	const vocabulary = metadataVocabulary(metadataValues)

	let llmResult: Awaited<ReturnType<typeof extractRecipeFromText>>

	if (intentKey === 'extract-image') {
		const validatedImages: Array<{ base64: string; mediaType: string }> = []

		for (const file of imageFiles) {
			const buffer = await file.arrayBuffer()

			// Re-check actual buffer size (stream-level check may use client-reported size)
			if (buffer.byteLength > MAX_IMAGE_SIZE) {
				return data(
					{
						intent: intentKey,
						error:
							'One or more images are too large. Maximum size is 5MB each.',
						recipe: null,
						result: null,
						duplicates: null,
					},
					{ status: 400 },
				)
			}

			// Validate magic bytes — don't trust client-provided Content-Type
			const detectedType = detectImageMediaType(buffer)
			if (
				!detectedType ||
				!ALLOWED_IMAGE_MEDIA_TYPES.includes(
					detectedType as (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number],
				)
			) {
				return data(
					{
						intent: intentKey,
						error:
							'Invalid image file. Please upload JPEG, PNG, or WebP images.',
						recipe: null,
						result: null,
						duplicates: null,
					},
					{ status: 400 },
				)
			}

			validatedImages.push({
				base64: Buffer.from(buffer).toString('base64'),
				mediaType: detectedType,
			})
		}

		llmResult = await extractRecipeFromImages(validatedImages, vocabulary)
	} else {
		llmResult = await extractRecipeFromText(rawText, vocabulary)
	}

	if ('error' in llmResult) {
		return data(
			{
				intent: intentKey,
				error: llmResult.error,
				recipe: null,
				result: null,
				duplicates: null,
			},
			{ status: 422 },
		)
	}

	const recipe: ExtractedRecipe = {
		title: llmResult.title,
		description: llmResult.description,
		notes: llmResult.notes,
		activeTime: llmResult.activeTime,
		totalTime: llmResult.totalTime,
		yieldAmount: llmResult.yieldAmount,
		yieldLabel: llmResult.yieldLabel,
		sourceUrl: (formData.get('sourceUrl') as string) || '',
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

	// Check for duplicates
	const duplicates: DuplicateMatch[] = []
	const titleMatches = await prisma.recipe.findMany({
		where: {
			householdId,
			title: { equals: recipe.title },
		},
		select: { id: true, title: true, sourceUrl: true },
	})
	for (const match of titleMatches) {
		duplicates.push({ ...match, matchReason: 'similar-title' })
	}

	captureServerEvent(userId, AI_FEATURE_USED, {
		feature: 'recipe_extract',
		source: intentKey === 'extract-image' ? 'image' : 'text',
		...(intentKey === 'extract-image' && {
			image_count: imageFiles.length,
		}),
	})

	return data({
		intent: intentKey,
		recipe,
		error: null,
		result: null,
		duplicates: duplicates.length > 0 ? duplicates : null,
	})
}
