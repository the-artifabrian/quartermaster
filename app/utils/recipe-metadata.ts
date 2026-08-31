import { z } from 'zod'

export const RECIPE_METADATA_DIMENSIONS = [
	'cuisine',
	'season',
	'course',
] as const

export type RecipeMetadataDimension =
	(typeof RECIPE_METADATA_DIMENSIONS)[number]

export const RECIPE_METADATA_LABELS: Record<RecipeMetadataDimension, string> = {
	cuisine: 'Cuisine',
	season: 'Season',
	course: 'Course',
}

export const RecipeMetadataDimensionSchema = z.enum(RECIPE_METADATA_DIMENSIONS)

export function recipeMetadataName(value: string) {
	return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function recipeMetadataNameKey(value: string) {
	return recipeMetadataName(value).toLowerCase()
}

export const RecipeMetadataNameSchema = z
	.string()
	.transform(recipeMetadataName)
	.pipe(
		z
			.string()
			.min(1, { message: 'Enter a name' })
			.max(50, { message: 'Keep names to 50 characters or fewer' }),
	)

export const DEFAULT_RECIPE_METADATA_VALUES = [
	{ dimension: 'season', name: 'Year-round', sortOrder: 0 },
	{ dimension: 'season', name: 'Spring', sortOrder: 10 },
	{ dimension: 'season', name: 'Summer', sortOrder: 20 },
	{ dimension: 'season', name: 'Autumn', sortOrder: 30 },
	{ dimension: 'season', name: 'Winter', sortOrder: 40 },
	{ dimension: 'course', name: 'Breakfast', sortOrder: 0 },
	{ dimension: 'course', name: 'Main', sortOrder: 10 },
	{ dimension: 'course', name: 'Side', sortOrder: 20 },
	{ dimension: 'course', name: 'Dessert', sortOrder: 30 },
] satisfies Array<{
	dimension: RecipeMetadataDimension
	name: string
	sortOrder: number
}>

export const DEFAULT_RECIPE_METADATA_VALUE_CREATE =
	DEFAULT_RECIPE_METADATA_VALUES.map((value) => ({
		...value,
		nameKey: recipeMetadataNameKey(value.name),
	}))

const customValuesSchema = z.object({
	cuisine: z.array(RecipeMetadataNameSchema).max(20).default([]),
	season: z.array(RecipeMetadataNameSchema).max(20).default([]),
	course: z.array(RecipeMetadataNameSchema).max(20).default([]),
})

export const RecipeMetadataSelectionSchema = z.object({
	selectedValueIds: z.array(z.string().min(1)).max(60).default([]),
	newValues: customValuesSchema.default({
		cuisine: [],
		season: [],
		course: [],
	}),
})

export type RecipeMetadataSelection = z.infer<
	typeof RecipeMetadataSelectionSchema
>

export const EMPTY_RECIPE_METADATA_SELECTION: RecipeMetadataSelection = {
	selectedValueIds: [],
	newValues: { cuisine: [], season: [], course: [] },
}

export const RecipeMetadataSelectionFieldSchema = z.preprocess((value) => {
	if (value == null || value === '') return EMPTY_RECIPE_METADATA_SELECTION
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}, RecipeMetadataSelectionSchema)

export function recipeMetadataIdentity(
	dimension: RecipeMetadataDimension,
	nameKey: string,
) {
	return `${dimension}:${nameKey}`
}

export function emptyRecipeMetadataGroups<T>() {
	return {
		cuisine: [] as T[],
		season: [] as T[],
		course: [] as T[],
	}
}

export function groupRecipeMetadataValues<T extends { dimension: string }>(
	values: T[],
) {
	const groups = emptyRecipeMetadataGroups<T>()
	for (const value of values) {
		const parsed = RecipeMetadataDimensionSchema.safeParse(value.dimension)
		if (parsed.success) groups[parsed.data].push(value)
	}
	return groups
}
