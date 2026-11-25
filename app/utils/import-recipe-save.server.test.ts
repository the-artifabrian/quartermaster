/**
 * Saving an import checks for a Recipe from the same link and creates the new
 * one in a single write transaction.
 */
import { expect, test } from 'vitest'
import { type PrismaClient } from '#app/generated/prisma/client.ts'
import { createUser } from '#tests/db-utils.ts'
import { createWalDatabase } from '#tests/sqlite-concurrency.ts'
import { type ExtractedRecipe } from './import-recipe-types.ts'
import { saveImportedRecipe } from './import-recipe-save.server.ts'
import '#tests/setup/db-setup.ts'

const URL = 'https://example.com/recipes/lentil-soup'

function extracted(): ExtractedRecipe {
	return {
		rawText: 'Lentil soup',
		title: 'Lentil soup',
		description: null,
		notes: null,
		activeTime: null,
		totalTime: null,
		yieldAmount: null,
		yieldLabel: null,
		sourceUrl: URL,
		metadataValueIds: [],
		ingredients: [{ name: 'lentils', amount: '200', unit: 'g' }],
		instructions: [{ content: 'Simmer the lentils.' }],
	}
}

async function newHousehold(db: PrismaClient) {
	const user = await db.user.create({ data: createUser() })
	const household = await db.household.create({
		data: {
			name: 'Import household',
			members: { create: { userId: user.id, role: 'owner' } },
		},
	})
	return { userId: user.id, householdId: household.id }
}

async function answer(response: Response | { data: unknown }) {
	if (response instanceof Response) {
		return { location: response.headers.get('location') }
	}
	return response.data
}

// A shared link's automatic save and a tap can arrive together.
test('two saves of the same link at once keep one Recipe and answer the second with it', async () => {
	await using database = await createWalDatabase()
	const { db } = database
	const owner = await newHousehold(db)

	const [first, second] = await Promise.all([
		saveImportedRecipe(extracted(), 'fetch', owner, db),
		saveImportedRecipe(extracted(), 'fetch', owner, db),
	])

	const saved = await db.recipe.findMany({
		where: { householdId: owner.householdId },
		select: { id: true, title: true },
	})
	expect(saved).toHaveLength(1)
	const answers = [await answer(first), await answer(second)]
	expect(answers).toContainEqual({
		location: expect.stringMatching(`^/recipes/${saved[0]!.id}\\?`),
	})
	expect(answers).toContainEqual({
		intent: 'fetch',
		error: null,
		existing: { id: saved[0]!.id, title: 'Lentil soup' },
	})
})

test('another Household’s Recipe from the same link doesn’t stop a save', async () => {
	await using database = await createWalDatabase()
	const { db } = database
	const first = await newHousehold(db)
	const second = await newHousehold(db)

	await saveImportedRecipe(extracted(), 'fetch', first, db)
	const response = await saveImportedRecipe(extracted(), 'fetch', second, db)

	expect(response).toBeInstanceOf(Response)
	expect(
		await db.recipe.count({ where: { householdId: second.householdId } }),
	).toBe(1)
})
