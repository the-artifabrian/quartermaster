import { type Prisma } from '#app/generated/prisma/client.ts'
import {
	RECIPE_METADATA_DIMENSIONS,
	type RecipeMetadataDimension,
} from './recipe-metadata.ts'

export type RecipeMetadataFilters = Record<RecipeMetadataDimension, string[]>

/**
 * Recipe classification filters OR values within one dimension and AND the
 * active dimensions together. Empty dimensions add no constraint.
 */
export function recipeMetadataFilterWhere(
	filters: RecipeMetadataFilters,
): Prisma.RecipeWhereInput {
	return {
		AND: RECIPE_METADATA_DIMENSIONS.flatMap((dimension) => {
			const nameKeys = [...new Set(filters[dimension])]
			return nameKeys.length
				? [
						{
							metadataAssignments: {
								some: {
									value: { dimension, nameKey: { in: nameKeys } },
								},
							},
						},
					]
				: []
		}),
	}
}
