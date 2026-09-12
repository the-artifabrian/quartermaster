import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { expect, test } from 'vitest'

test('check versions preserve existing purchases and follow contribution changes atomically', async () => {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), 'qm-check-migration-'),
	)
	const db = createClient({ url: `file:${path.join(directory, 'test.db')}` })
	try {
		await db.executeMultiple(`
			CREATE TABLE ShoppingListItem (
				id TEXT PRIMARY KEY, name TEXT, quantity TEXT, unit TEXT,
				checked BOOLEAN, source TEXT, horizon TEXT, listId TEXT
			);
			CREATE TABLE MealShoppingContribution (
				id TEXT PRIMARY KEY, itemId TEXT, mealId TEXT, canonicalName TEXT,
				name TEXT, quantity TEXT, unit TEXT
			);
			INSERT INTO ShoppingListItem VALUES ('rice', 'Rice', '200', 'g', 1, 'manual', 'next', 'list');
			INSERT INTO ShoppingListItem VALUES ('other', 'Rice', '400', 'g', 0, 'meal', 'later', 'list');
		`)
		await db.executeMultiple(
			await fs.readFile(
				new URL(
					'../../prisma/migrations/20260912163000_shopping_check_preconditions/migration.sql',
					import.meta.url,
				),
				'utf8',
			),
		)
		expect(
			(
				await db.execute(
					"SELECT name, quantity, checked, checkVersion, lastCheckMutationId FROM ShoppingListItem WHERE id = 'rice'",
				)
			).rows,
		).toEqual([
			{
				name: 'Rice',
				quantity: '200',
				checked: 1,
				checkVersion: 0,
				lastCheckMutationId: null,
			},
		])
		await db.execute(
			"UPDATE ShoppingListItem SET checked = 0 WHERE id = 'rice'",
		)
		await db.execute(
			"INSERT INTO MealShoppingContribution VALUES ('c', 'rice', 'meal', 'rice', 'Rice', '400', 'g')",
		)
		await db.execute(
			"UPDATE MealShoppingContribution SET quantity = '600' WHERE id = 'c'",
		)
		await db.execute(
			"UPDATE MealShoppingContribution SET itemId = 'other' WHERE id = 'c'",
		)
		await db.execute("DELETE FROM MealShoppingContribution WHERE id = 'c'")
		expect(
			(
				await db.execute(
					'SELECT id, checkVersion FROM ShoppingListItem ORDER BY id',
				)
			).rows,
		).toEqual([
			{ id: 'other', checkVersion: 2 },
			{ id: 'rice', checkVersion: 4 },
		])
		const tx = await db.transaction('write')
		await tx.execute(
			"UPDATE ShoppingListItem SET quantity = '1000' WHERE id = 'rice'",
		)
		await tx.rollback()
		expect(
			(
				await db.execute(
					"SELECT quantity, checkVersion FROM ShoppingListItem WHERE id = 'rice'",
				)
			).rows,
		).toEqual([{ quantity: '200', checkVersion: 4 }])
		// Retrying the same value is not another content revision.
		await db.execute(
			"UPDATE ShoppingListItem SET quantity = '200' WHERE id = 'rice'",
		)
		expect(
			(
				await db.execute(
					"SELECT checkVersion FROM ShoppingListItem WHERE id = 'rice'",
				)
			).rows,
		).toEqual([{ checkVersion: 4 }])
	} finally {
		db.close()
		await fs.rm(directory, { recursive: true, force: true })
	}
})
