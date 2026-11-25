// Writes a parsed export file into the Household, one section after another.

import { prisma } from '#app/utils/db.server.ts'
import { captureServerEvent } from '#app/utils/posthog.server.ts'
import { ensureRecipeMetadataValues } from '#app/utils/recipe-metadata.server.ts'
import {
	RecipeMetadataDimensionSchema,
	recipeMetadataIdentity,
} from '#app/utils/recipe-metadata.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type parseImportData } from './+backup-format.ts'
import { importMealPlans } from './restore-meals.server.ts'
import { importMenus } from './restore-menus.server.ts'
import { importRecipes, type RecipeIndex } from './restore-recipes.server.ts'
import {
	type ImportResults,
	type RecordFailure,
	type RestoreFailure,
} from './restore-results.server.ts'
import { importShopping } from './restore-shopping.server.ts'
import { importHouseholdIngredients } from './restore-staples.server.ts'

/**
 * Writes a parsed export into the Household, section by section. Each item is
 * its own write, so an unexpected error leaves what came before it saved.
 */
export async function restore(
	importResult: Exclude<ReturnType<typeof parseImportData>, { error: string }>,
	{ userId, householdId }: { userId: string; householdId: string },
) {
	const recipes = importResult.data.recipes
	// Everything in a full export restores on every tier.
	const fullData = importResult.type === 'full' ? importResult.data : null

	const results: ImportResults = {
		recipes: { created: 0, skipped: 0, errored: 0 },
		menus: { created: 0, skipped: 0, errored: 0 },
		recipeMetadataValues: { created: 0, skipped: 0 },
		householdIngredients: { created: 0, skipped: 0 },
		mealPlans: { created: 0, skipped: 0, errored: 0 },
		meals: { created: 0, skipped: 0, errored: 0 },
		shoppingLists: { created: 0, skipped: 0 },
	}

	const failures: RestoreFailure[] = []
	const recordFailure: RecordFailure = (failure) => {
		failures.push(failure)
		console.error(
			`Restore: ${failure.at} couldn't be restored (${failure.reason})`,
			{ householdId, ...failure },
		)
	}

	// Recipe classifications go in before Recipes, so values no Recipe uses
	// still come back. Where a value already exists, its display name wins.
	if (fullData?.recipeMetadataValues?.length) {
		await writeTransaction(prisma, async (tx) => {
			const existing = await tx.recipeMetadataValue.findMany({
				where: { householdId },
				select: { dimension: true, nameKey: true },
			})
			const existingIdentities = new Set(
				existing.map((value) =>
					recipeMetadataIdentity(
						RecipeMetadataDimensionSchema.parse(value.dimension),
						value.nameKey,
					),
				),
			)
			for (const value of fullData.recipeMetadataValues ?? []) {
				const identity = recipeMetadataIdentity(value.dimension, value.nameKey)
				if (existingIdentities.has(identity)) {
					results.recipeMetadataValues.skipped++
					continue
				}
				await ensureRecipeMetadataValues(tx, householdId, [value])
				existingIdentities.add(identity)
				results.recipeMetadataValues.created++
			}
		})
	}

	const recipeIndex: RecipeIndex = {
		titleToIdMap: new Map(),
		refToIdMap: new Map(),
		titleById: new Map(),
	}
	const existingRecipes = await prisma.recipe.findMany({
		where: { householdId },
		select: { id: true, title: true },
	})
	for (const r of existingRecipes) {
		recipeIndex.titleToIdMap.set(r.title.toLowerCase(), r.id)
		recipeIndex.titleById.set(r.id, r.title)
	}
	results.recipes = await importRecipes(
		recipes,
		recipeIndex,
		userId,
		householdId,
		recordFailure,
	)

	// Menus after Recipes, so their references can reconnect.
	let sharedMenuIdsByTitleKey = new Map<string, string | null>()
	if (fullData?.menus?.length) {
		const imported = await importMenus(
			fullData.menus,
			recipeIndex,
			householdId,
			recordFailure,
		)
		results.menus = imported.stats
		sharedMenuIdsByTitleKey = imported.sharedMenuIdsByTitleKey
	}

	if (fullData?.householdIngredients !== undefined) {
		results.householdIngredients = await importHouseholdIngredients(
			fullData.householdIngredients,
			householdId,
		)
	}

	let mealIdByRef = new Map<string, string>()
	if (fullData?.mealPlans) {
		const imported = await importMealPlans(
			fullData.mealPlans,
			fullData.recipes,
			recipeIndex,
			sharedMenuIdsByTitleKey,
			householdId,
			recordFailure,
		)
		results.mealPlans = imported.stats.mealPlans
		results.meals = imported.stats.meals
		mealIdByRef = imported.mealIdByRef
	}

	if (fullData?.shoppingLists?.length) {
		results.shoppingLists = await importShopping(
			fullData.shoppingLists,
			mealIdByRef,
			userId,
			householdId,
			recordFailure,
		)
	}

	if (failures.length > 0) {
		// Its own event: a user's file with bad parts isn't a server error.
		captureServerEvent(userId, 'restore_failed_items', {
			householdId,
			failureCount: failures.length,
			// Enough to find the pattern without sending thousands of rows.
			failures: failures
				.slice(0, 20)
				.map(({ at, reason, count, code }) => ({ at, reason, count, code })),
		})
	}

	return { error: null, results }
}
