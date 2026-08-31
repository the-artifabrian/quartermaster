import { type Prisma } from '#app/generated/prisma/client.ts'
import {
	RECIPE_METADATA_DIMENSIONS,
	RecipeMetadataDimensionSchema,
	RecipeMetadataNameSchema,
	type RecipeMetadataSelection,
	recipeMetadataNameKey,
	recipeMetadataIdentity,
} from './recipe-metadata.ts'

export class RecipeMetadataSelectionError extends Error {}

export async function resolveRecipeMetadataValueIds(
	tx: Prisma.TransactionClient,
	householdId: string,
	selection: RecipeMetadataSelection,
) {
	const selectedIds = [...new Set(selection.selectedValueIds)]
	const selectedValues = selectedIds.length
		? await tx.recipeMetadataValue.findMany({
				where: { id: { in: selectedIds }, householdId },
				select: { id: true },
			})
		: []

	if (selectedValues.length !== selectedIds.length) {
		throw new RecipeMetadataSelectionError(
			'One or more Recipe classifications are not available in this household.',
		)
	}

	const valueIds = new Set(selectedValues.map((value) => value.id))
	for (const dimension of RECIPE_METADATA_DIMENSIONS) {
		const namesByKey = new Map<string, string>()
		for (const input of selection.newValues[dimension]) {
			const parsed = RecipeMetadataNameSchema.safeParse(input)
			if (!parsed.success) {
				throw new RecipeMetadataSelectionError(
					parsed.error.issues[0]?.message ?? 'Invalid classification name.',
				)
			}
			namesByKey.set(recipeMetadataNameKey(parsed.data), parsed.data)
		}

		for (const [nameKey, name] of namesByKey) {
			const value = await tx.recipeMetadataValue.upsert({
				where: {
					householdId_dimension_nameKey: {
						householdId,
						dimension,
						nameKey,
					},
				},
				// The household's existing display value wins on normalized identity.
				update: {},
				create: { householdId, dimension, name, nameKey },
				select: { id: true },
			})
			valueIds.add(value.id)
		}
	}

	return [...valueIds]
}

type PortableRecipeMetadataValue = {
	dimension: string
	name: string
	nameKey: string
	sortOrder?: number
}

export async function ensureRecipeMetadataValues(
	tx: Prisma.TransactionClient,
	householdId: string,
	values: PortableRecipeMetadataValue[],
) {
	const valueIds: string[] = []
	for (const input of values) {
		const dimension = RecipeMetadataDimensionSchema.parse(input.dimension)
		const name = RecipeMetadataNameSchema.parse(input.name)
		const nameKey = recipeMetadataNameKey(name)
		if (input.nameKey !== nameKey) {
			throw new RecipeMetadataSelectionError(
				'Recipe classification identity does not match its name.',
			)
		}
		const value = await tx.recipeMetadataValue.upsert({
			where: {
				householdId_dimension_nameKey: {
					householdId,
					dimension,
					nameKey,
				},
			},
			update: {},
			create: {
				householdId,
				dimension,
				name,
				nameKey,
				sortOrder: input.sortOrder ?? 1000,
			},
			select: { id: true },
		})
		valueIds.push(value.id)
	}
	return valueIds
}

/**
 * Move a sole member's household vocabulary into an existing household.
 * Target display values win on normalized collisions; source assignments are
 * remapped before the duplicate source value is removed.
 */
export async function moveRecipeMetadataValues(
	tx: Prisma.TransactionClient,
	fromHouseholdId: string,
	toHouseholdId: string,
) {
	const targetValues = await tx.recipeMetadataValue.findMany({
		where: { householdId: toHouseholdId },
		select: { id: true, dimension: true, nameKey: true },
	})
	const targetByIdentity = new Map(
		targetValues.map((value) => [
			recipeMetadataIdentity(
				RecipeMetadataDimensionSchema.parse(value.dimension),
				value.nameKey,
			),
			value.id,
		]),
	)
	const sourceValues = await tx.recipeMetadataValue.findMany({
		where: { householdId: fromHouseholdId },
		select: { id: true, dimension: true, nameKey: true },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
	})

	for (const source of sourceValues) {
		const identity = recipeMetadataIdentity(
			RecipeMetadataDimensionSchema.parse(source.dimension),
			source.nameKey,
		)
		const targetId = targetByIdentity.get(identity)
		if (!targetId) {
			await tx.recipeMetadataValue.update({
				where: { id: source.id },
				data: { householdId: toHouseholdId },
			})
			targetByIdentity.set(identity, source.id)
			continue
		}

		const assignments = await tx.recipeMetadataAssignment.findMany({
			where: { valueId: source.id },
			select: { recipeId: true },
		})
		for (const assignment of assignments) {
			await tx.recipeMetadataAssignment.upsert({
				where: {
					recipeId_valueId: {
						recipeId: assignment.recipeId,
						valueId: targetId,
					},
				},
				update: {},
				create: { recipeId: assignment.recipeId, valueId: targetId },
			})
		}
		await tx.recipeMetadataValue.delete({ where: { id: source.id } })
	}
}
