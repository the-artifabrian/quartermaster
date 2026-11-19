import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { remember } from '@epic-web/remember'
import { z } from 'zod'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import { demandIdentity } from './shopping-demand.server.ts'
import { writeTransaction } from './write-transaction.server.ts'

/**
 * Deletes that Undo can reverse. Each delete happens at once and answers with
 * a snapshot of everything it removed, cascades included; Undo sends the
 * snapshot back and the restore puts it back. Nothing doomed waits on the
 * server, so a member adding the same thing in the meantime adds to a list
 * where the row is already gone.
 *
 * The snapshot travels to the browser and back sealed (`sealUndo`): signed
 * with the session secret, bound to the Household and member who deleted,
 * and good for a couple of minutes. A restore opens only a seal it made, and
 * still checks every reference against the Household inside the restore: a
 * Recipe, Menu, Meal or row outside it is dropped.
 */

type Db = PrismaClient
type Scope = { householdId: string }

const id = z.string().min(1).max(64)
const text = z.string().max(2000)
const date = z.coerce.date()

/**
 * What one Undo can carry. Clear checked takes at most this many rows (the
 * page sends no more), and they carry at most this many Meal amounts: a big
 * restore holds the database for every request, so it stays small.
 */
export const MAX_UNDO_ROWS = 500
export const MAX_UNDO_AMOUNTS = MAX_UNDO_ROWS * 2

/** The longest Shopping text anything writes (ingredient and line names). */
const LIMIT = { name: 300, quantity: 100, unit: 60, category: 60, word: 20 }
const name = z.string().max(LIMIT.name)
const quantity = z.string().max(LIMIT.quantity).nullable()
const unit = z.string().max(LIMIT.unit).nullable()

const ContributionSnapshot = z.object({
	id,
	mealId: id.nullable(),
	itemId: id,
	canonicalName: name,
	name,
	quantity,
	unit,
	createdAt: date,
})

const ShoppingRowSnapshot = z.object({
	id,
	name,
	quantity,
	unit,
	category: z.string().max(LIMIT.category).nullable(),
	checked: z.boolean(),
	checkVersion: z.number().int(),
	source: z.string().max(LIMIT.word),
	horizon: z.string().max(LIMIT.word),
	createdAt: date,
	mealContributions: z.array(ContributionSnapshot),
})

const shoppingRows = z
	.array(ShoppingRowSnapshot)
	.max(MAX_UNDO_ROWS)
	.refine(
		(rows) =>
			rows.reduce((sum, row) => sum + row.mealContributions.length, 0) <=
			MAX_UNDO_AMOUNTS,
		'Too many Meal amounts to undo',
	)

/**
 * The longest seal a Clear checked at its limits can make, worked out from
 * the limits: every field at its longest, written as JSON (key names, quotes,
 * and up to three bytes for each character of non-ASCII text), then base64.
 */
const ROW_CHARS =
	220 +
	64 +
	LIMIT.name +
	LIMIT.quantity +
	LIMIT.unit +
	LIMIT.category +
	2 * LIMIT.word +
	60
const AMOUNT_CHARS =
	160 + 3 * 64 + 2 * LIMIT.name + LIMIT.quantity + LIMIT.unit + 30
export const MAX_UNDO_TOKEN =
	Math.ceil(
		((MAX_UNDO_ROWS * ROW_CHARS + MAX_UNDO_AMOUNTS * AMOUNT_CHARS + 1024) *
			3 *
			4) /
			3,
	) + 128

const MealSnapshot = z.object({
	meal: z.object({
		id,
		mealPlanId: id,
		date,
		order: z.number().int(),
		label: text.nullable(),
		servingAt: date.nullable(),
		servingTimeZone: text.nullable(),
		genericText: text.nullable(),
		completed: z.boolean(),
		guestCount: z.number().int().nullable(),
		sourceMenuId: id.nullable(),
		sourceMenuRevision: date.nullable(),
		createdAt: date,
	}),
	sections: z.array(
		z.object({
			id,
			name: text.nullable(),
			order: z.number().int(),
			createdAt: date,
		}),
	),
	recipeItems: z.array(
		z.object({
			id,
			order: z.number().int(),
			recipeTitle: text,
			scaleMultiplier: z.number(),
			cooked: z.boolean(),
			note: text.nullable(),
			recipeId: id.nullable(),
			sectionId: id.nullable(),
			createdAt: date,
		}),
	),
	noteItems: z.array(
		z.object({
			id,
			order: z.number().int(),
			text,
			sectionId: id.nullable(),
			createdAt: date,
			shoppingLines: z.array(
				z.object({
					id,
					name: text,
					quantity: text.nullable(),
					unit: text.nullable(),
					order: z.number().int(),
					createdAt: date,
				}),
			),
		}),
	),
	/** Contributions the delete orphaned (kept Shopping): relinked on restore. */
	orphanedContributionIds: z.array(id),
	/** Contributions the delete removed, on rows that stayed. */
	removedContributions: z.array(ContributionSnapshot).max(MAX_UNDO_AMOUNTS),
	/** Rows the delete removed with their amounts (remove generated amount). */
	removedRows: shoppingRows,
})

const MealItemSnapshot = z.object({
	id,
	mealId: id,
	order: z.number().int(),
	recipeTitle: text,
	scaleMultiplier: z.number(),
	cooked: z.boolean(),
	note: text.nullable(),
	recipeId: id.nullable(),
	sectionId: id.nullable(),
	createdAt: date,
})

export const UndoSnapshot = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('shopping'),
		rows: shoppingRows,
	}),
	z.object({ kind: z.literal('meal'), meal: MealSnapshot }),
	z.object({ kind: z.literal('meal-item'), item: MealItemSnapshot }),
	z.object({ kind: z.literal('staple'), id }),
])
export type UndoSnapshot = z.infer<typeof UndoSnapshot>

export type DeleteResult =
	| { status: 'gone' }
	| { status: 'deleted'; snapshot: UndoSnapshot; count: number; name?: string }

/** Longer than the Undo toast, with room for a slow network. */
export const UNDO_TOKEN_TTL_MS = 2 * 60_000

type Member = { householdId: string; userId: string }

function undoSecrets() {
	// SESSION_SECRET may list several for rotation: seal with the first.
	return (process.env.SESSION_SECRET ?? '').split(',').filter(Boolean)
}

const signUndo = (body: string, secret: string) =>
	createHmac('sha256', secret)
		.update(`undo-delete\n${body}`)
		.digest('base64url')

/** What Undo sends back: the snapshot, signed and bound to who deleted. */
export function sealUndo(
	snapshot: UndoSnapshot,
	{ householdId, userId }: Member,
	now = Date.now(),
) {
	const [secret] = undoSecrets()
	if (!secret) throw new Error('SESSION_SECRET is required to seal an Undo')
	const body = Buffer.from(
		JSON.stringify({
			s: snapshot,
			h: householdId,
			u: userId,
			e: now + UNDO_TOKEN_TTL_MS,
			n: randomUUID(),
		}),
	).toString('base64url')
	return `${body}.${signUndo(body, secret)}`
}

/**
 * The snapshot in a seal, or null for one this server did not make, made for
 * another member or Household, or past its time.
 */
export function openUndo(
	token: string,
	member: Member,
	now = Date.now(),
): UndoSnapshot | null {
	return readUndo(token, member, now)?.snapshot ?? null
}

/** Seals already used, until they would have expired anyway. */
const usedSeals = remember('usedUndoSeals', () => new Map<string, number>())

/**
 * Opens a seal for its one restore. A seal used before answers `used`, so a
 * replay (a double tap that got through, a resent request) puts nothing back
 * twice. Kept in memory: after a restart within its two minutes a seal could
 * open again, and the restores themselves still never double a row that is
 * back.
 */
export function redeemUndo(
	token: string,
	member: Member,
	now = Date.now(),
): { snapshot: UndoSnapshot; release: () => void } | 'refused' | 'used' {
	const opened = readUndo(token, member, now)
	if (!opened) return 'refused'
	for (const [nonce, expires] of usedSeals) {
		if (expires < now) usedSeals.delete(nonce)
	}
	if (usedSeals.has(opened.nonce)) return 'used'
	// Taken at once, so a second copy arriving while this one restores is a
	// replay; given back if the restore fails, so a retry can still use it.
	usedSeals.set(opened.nonce, opened.expires)
	return {
		snapshot: opened.snapshot,
		release: () => usedSeals.delete(opened.nonce),
	}
}

function readUndo(token: string, { householdId, userId }: Member, now: number) {
	const [body, mac, extra] = token.split('.')
	if (!body || !mac || extra !== undefined) return null
	const given = Buffer.from(mac)
	const signed = undoSecrets().some((secret) => {
		const expected = Buffer.from(signUndo(body, secret))
		return expected.length === given.length && timingSafeEqual(expected, given)
	})
	if (!signed) return null
	let sealed: {
		s?: unknown
		h?: unknown
		u?: unknown
		e?: unknown
		n?: unknown
	}
	try {
		sealed = JSON.parse(
			Buffer.from(body, 'base64url').toString('utf8'),
		) as typeof sealed
	} catch {
		return null
	}
	if (sealed.h !== householdId || sealed.u !== userId) return null
	if (typeof sealed.e !== 'number' || sealed.e < now) return null
	if (typeof sealed.n !== 'string') return null
	const parsed = UndoSnapshot.safeParse(sealed.s)
	if (!parsed.success) return null
	return { snapshot: parsed.data, nonce: sealed.n, expires: sealed.e }
}

const shoppingRowSelect = {
	id: true,
	name: true,
	quantity: true,
	unit: true,
	category: true,
	checked: true,
	checkVersion: true,
	source: true,
	horizon: true,
	createdAt: true,
	mealContributions: {
		select: {
			id: true,
			mealId: true,
			itemId: true,
			canonicalName: true,
			name: true,
			quantity: true,
			unit: true,
			createdAt: true,
		},
	},
} as const

type Tx = Prisma.TransactionClient
type ShoppingRow = z.infer<typeof ShoppingRowSnapshot>

/**
 * Delete Shopping rows of the Household; their Meal amounts go with them.
 * `checkedOnly` (Clear checked) takes only rows still checked: one the other
 * phone unchecked a moment ago stays. The snapshot is exactly what went.
 */
export function deleteShoppingRows(
	db: Db,
	{
		householdId,
		ids,
		checkedOnly,
	}: Scope & { ids: string[]; checkedOnly?: boolean },
): Promise<DeleteResult> {
	return writeTransaction(db, async (tx) => {
		const where = {
			list: { householdId },
			...(checkedOnly ? { checked: true } : {}),
		}
		const rows = await tx.shoppingListItem.findMany({
			where: { ...where, id: { in: ids } },
			select: shoppingRowSelect,
		})
		if (rows.length === 0) return { status: 'gone' as const }
		const { count } = await tx.shoppingListItem.deleteMany({
			where: { ...where, id: { in: rows.map((row) => row.id) } },
		})
		return {
			status: 'deleted' as const,
			snapshot: { kind: 'shopping' as const, rows },
			count,
			name: rows.length === 1 ? rows[0]!.name : undefined,
		}
	})
}

/**
 * Put Shopping rows back inside a write transaction, and count what came
 * back:
 * - a row in another Household's list is never touched, nor its amounts;
 * - a row already in this list (back already, or never removed) is not made
 *   again, but its amounts still come back to it;
 * - an unchecked row whose item has been added again since (unchecked, same
 *   demand, whichever section it is in) is not doubled: its Meal amounts join
 *   that row, which keeps its own quantity and section;
 * - a checked row comes back beside anything added since, as a checked
 *   purchase does;
 * - an amount whose Meal has gone since (or is not this Household's), or
 *   whose Meal already has that demand on another row, is left out.
 */
async function putBackShoppingRows(
	tx: Tx,
	{
		householdId,
		rows,
		restoringMealId,
	}: Scope & {
		rows: ShoppingRow[]
		/** A Meal coming back in the same transaction counts as live. */
		restoringMealId?: string
	},
) {
	const counts = { restored: 0, merged: 0, amounts: 0, names: [] as string[] }
	if (rows.length === 0) return counts
	const list = await tx.shoppingList.findFirst({
		where: { householdId },
		select: { id: true },
	})
	if (!list) return counts
	const contributions = rows.flatMap((row) => row.mealContributions)
	const mealIds = [
		...new Set(contributions.flatMap((c) => (c.mealId ? [c.mealId] : []))),
	]
	const [present, unchecked, meals, taken] = await Promise.all([
		tx.shoppingListItem.findMany({
			where: { id: { in: rows.map((row) => row.id) } },
			select: { id: true, listId: true },
		}),
		tx.shoppingListItem.findMany({
			where: { listId: list.id, checked: false },
			select: { id: true, name: true },
		}),
		tx.meal.findMany({
			where: { id: { in: mealIds }, mealPlan: { householdId } },
			select: { id: true },
		}),
		tx.mealShoppingContribution.findMany({
			where: {
				OR: [
					{ id: { in: contributions.map((c) => c.id) } },
					{
						mealId: {
							in: [...mealIds, ...(restoringMealId ? [restoringMealId] : [])],
						},
					},
				],
			},
			select: { id: true, mealId: true, canonicalName: true },
		}),
	])
	const listOf = new Map(present.map((row) => [row.id, row.listId]))
	const uncheckedByDemand = new Map(
		unchecked.map((row) => [demandIdentity(row.name), row.id]),
	)
	const liveMeals = new Set(meals.map((meal) => meal.id))
	if (restoringMealId) liveMeals.add(restoringMealId)
	const takenIds = new Set(taken.map((c) => c.id))
	const takenDemand = new Set(
		taken.map((c) => `${c.mealId}\n${c.canonicalName}`),
	)

	// Written in two statements, not one per row: a big restore holds the
	// database for every other request while it runs.
	const create: Prisma.ShoppingListItemCreateManyInput[] = []
	const amounts: Prisma.MealShoppingContributionCreateManyInput[] = []
	for (const row of rows) {
		const listId = listOf.get(row.id)
		if (listId && listId !== list.id) continue
		let target = row.id
		if (!listId) {
			const into = row.checked
				? undefined
				: uncheckedByDemand.get(demandIdentity(row.name))
			if (into) {
				target = into
				counts.merged++
			} else {
				create.push({
					id: row.id,
					listId: list.id,
					name: row.name,
					quantity: row.quantity,
					unit: row.unit,
					category: row.category,
					checked: row.checked,
					checkVersion: row.checkVersion,
					source: row.source,
					horizon: row.horizon,
					createdAt: row.createdAt,
				})
				counts.restored++
			}
			counts.names.push(row.name)
		}
		for (const contribution of row.mealContributions) {
			const mealId = contribution.mealId
			if (mealId && !liveMeals.has(mealId)) continue
			if (takenIds.has(contribution.id)) continue
			const demand = `${mealId}\n${contribution.canonicalName}`
			if (mealId && takenDemand.has(demand)) continue
			takenDemand.add(demand)
			takenIds.add(contribution.id)
			amounts.push({
				id: contribution.id,
				mealId,
				itemId: target,
				canonicalName: contribution.canonicalName,
				name: contribution.name,
				quantity: contribution.quantity,
				unit: contribution.unit,
				createdAt: contribution.createdAt,
			})
		}
	}
	if (create.length > 0) await tx.shoppingListItem.createMany({ data: create })
	if (amounts.length > 0) {
		await tx.mealShoppingContribution.createMany({ data: amounts })
	}
	counts.amounts = amounts.length
	return counts
}

/** Put deleted Shopping rows back; `gone` when nothing came back. */
export function restoreShoppingRows(
	db: Db,
	scope: Scope & { rows: ShoppingRow[] },
) {
	return writeTransaction(db, async (tx) => {
		const counts = await putBackShoppingRows(tx, scope)
		if (counts.restored + counts.merged + counts.amounts === 0) {
			return { status: 'gone' as const }
		}
		return { status: 'restored' as const, ...counts }
	})
}

const mealSnapshotSelect = {
	id: true,
	mealPlanId: true,
	date: true,
	order: true,
	label: true,
	servingAt: true,
	servingTimeZone: true,
	genericText: true,
	completed: true,
	guestCount: true,
	sourceMenuId: true,
	sourceMenuRevision: true,
	createdAt: true,
	sections: {
		select: { id: true, name: true, order: true, createdAt: true },
	},
	recipeItems: {
		select: {
			id: true,
			order: true,
			recipeTitle: true,
			scaleMultiplier: true,
			cooked: true,
			note: true,
			recipeId: true,
			sectionId: true,
			createdAt: true,
		},
	},
	noteItems: {
		select: {
			id: true,
			order: true,
			text: true,
			sectionId: true,
			createdAt: true,
			shoppingLines: {
				select: {
					id: true,
					name: true,
					quantity: true,
					unit: true,
					order: true,
					createdAt: true,
				},
			},
		},
	},
	shoppingContributions: { select: shoppingRowSelect.mealContributions.select },
} as const

/**
 * Inside a write transaction: delete a Meal of the Household with everything
 * it owns (sections, Recipe cards, notes and their Shopping lines) and answer
 * with its snapshot. Its Shopping rows stay, with its amounts orphaned, unless
 * `removeShoppingContributions`: then its amounts go, and so do rows left with
 * nothing else asking for them, decided after its amounts have gone.
 */
async function deleteMealIn(
	tx: Tx,
	{
		householdId,
		mealId,
		removeShoppingContributions,
	}: Scope & { mealId: string; removeShoppingContributions: boolean },
): Promise<DeleteResult> {
	const meal = await tx.meal.findFirst({
		where: { id: mealId, mealPlan: { householdId } },
		select: mealSnapshotSelect,
	})
	if (!meal) return { status: 'gone' }
	const { sections, recipeItems, noteItems, shoppingContributions, ...row } =
		meal

	let removedRows: ShoppingRow[] = []
	if (removeShoppingContributions) {
		await tx.mealShoppingContribution.deleteMany({ where: { mealId } })
		await tx.meal.delete({ where: { id: mealId } })
		const emptied = await tx.shoppingListItem.findMany({
			where: {
				id: { in: shoppingContributions.map((c) => c.itemId) },
				source: 'meal',
				list: { householdId },
				mealContributions: { none: {} },
			},
			select: { ...shoppingRowSelect, mealContributions: false },
		})
		await tx.shoppingListItem.deleteMany({
			where: { id: { in: emptied.map((item) => item.id) } },
		})
		removedRows = emptied.map((item) => ({
			...item,
			mealContributions: shoppingContributions.filter(
				(c) => c.itemId === item.id,
			),
		}))
	} else {
		await tx.meal.delete({ where: { id: mealId } })
	}
	const removedRowIds = new Set(removedRows.map((item) => item.id))
	return {
		status: 'deleted',
		count: 1,
		snapshot: {
			kind: 'meal',
			meal: {
				meal: row,
				sections,
				recipeItems,
				noteItems,
				orphanedContributionIds: removeShoppingContributions
					? []
					: shoppingContributions.map((c) => c.id),
				removedContributions: removeShoppingContributions
					? shoppingContributions.filter((c) => !removedRowIds.has(c.itemId))
					: [],
				removedRows,
			},
		},
	}
}

export function deleteMeal(
	db: Db,
	input: Scope & { mealId: string; removeShoppingContributions: boolean },
) {
	return writeTransaction(db, (tx) => deleteMealIn(tx, input))
}

/**
 * Put a deleted Meal back as it was, in one transaction. A Recipe or Menu
 * deleted since (or not this Household's) is left out, as their own deletes
 * would have; sections are only the ones it brings back; its Shopping amounts
 * come back on the rows still there (or rows put back), never doubling a row
 * added since. A Meal already back answers `gone`.
 */
export function restoreMeal(
	db: Db,
	{ householdId, snapshot }: Scope & { snapshot: z.infer<typeof MealSnapshot> },
) {
	const { meal } = snapshot
	return writeTransaction(db, async (tx) => {
		const [plan, existing, recipes, menu] = await Promise.all([
			tx.mealPlan.findFirst({
				where: { id: meal.mealPlanId, householdId },
				select: { id: true },
			}),
			tx.meal.findUnique({ where: { id: meal.id }, select: { id: true } }),
			tx.recipe.findMany({
				where: {
					id: {
						in: snapshot.recipeItems.flatMap((i) =>
							i.recipeId ? [i.recipeId] : [],
						),
					},
					householdId,
				},
				select: { id: true },
			}),
			meal.sourceMenuId
				? tx.menu.findFirst({
						where: { id: meal.sourceMenuId, householdId },
						select: { id: true },
					})
				: null,
		])
		if (!plan || existing) return { status: 'gone' as const }
		const liveRecipes = new Set(recipes.map((recipe) => recipe.id))
		const sectionIds = new Set(snapshot.sections.map((section) => section.id))
		const ownSection = (sectionId: string | null) =>
			sectionId && sectionIds.has(sectionId) ? sectionId : null

		await tx.meal.create({
			data: { ...meal, sourceMenuId: menu ? meal.sourceMenuId : null },
		})
		await tx.mealSection.createMany({
			data: snapshot.sections.map((section) => ({
				...section,
				mealId: meal.id,
			})),
		})
		await tx.mealRecipeItem.createMany({
			data: snapshot.recipeItems.map((item) => ({
				...item,
				mealId: meal.id,
				sectionId: ownSection(item.sectionId),
				recipeId:
					item.recipeId && liveRecipes.has(item.recipeId)
						? item.recipeId
						: null,
			})),
		})
		await tx.mealNoteItem.createMany({
			data: snapshot.noteItems.map(({ shoppingLines: _, ...note }) => ({
				...note,
				mealId: meal.id,
				sectionId: ownSection(note.sectionId),
			})),
		})
		await tx.mealShoppingLine.createMany({
			data: snapshot.noteItems.flatMap((note) =>
				note.shoppingLines.map((line) => ({ ...line, noteItemId: note.id })),
			),
		})
		await tx.mealShoppingContribution.updateMany({
			where: {
				id: { in: snapshot.orphanedContributionIds },
				mealId: null,
				item: { list: { householdId } },
			},
			data: { mealId: meal.id },
		})
		const rows = await putBackShoppingRows(tx, {
			householdId,
			rows: snapshot.removedRows,
			restoringMealId: meal.id,
		})
		// Amounts on rows that stayed: back, unless the row has gone since or
		// the Meal's demand is already there.
		let amounts = 0
		if (snapshot.removedContributions.length > 0) {
			const [liveRows, taken] = await Promise.all([
				tx.shoppingListItem.findMany({
					where: {
						id: { in: snapshot.removedContributions.map((c) => c.itemId) },
						list: { householdId },
					},
					select: { id: true },
				}),
				tx.mealShoppingContribution.findMany({
					where: { mealId: meal.id },
					select: { canonicalName: true },
				}),
			])
			const live = new Set(liveRows.map((r) => r.id))
			const takenDemand = new Set(taken.map((c) => c.canonicalName))
			const back = snapshot.removedContributions.filter(
				(c) => live.has(c.itemId) && !takenDemand.has(c.canonicalName),
			)
			if (back.length > 0) {
				await tx.mealShoppingContribution.createMany({
					data: back.map((c) => ({ ...c, mealId: meal.id })),
				})
			}
			amounts = back.length
		}
		return {
			status: 'restored' as const,
			// Relinked amounts were on Shopping all along: only what came back
			// counts as a change there.
			shoppingChanged: rows.restored + rows.merged + rows.amounts + amounts > 0,
		}
	})
}

/**
 * Remove one Recipe card from a Meal of the Household. A card that turns out
 * to be the Meal's last (no other cards or notes, counted after its delete,
 * so two members removing the last two at once cannot leave an empty Meal)
 * takes the Meal with it, and the answer is the whole Meal's snapshot.
 */
export function deleteMealItem(
	db: Db,
	{ householdId, itemId }: Scope & { itemId: string },
): Promise<DeleteResult> {
	return writeTransaction(db, async (tx) => {
		const item = await tx.mealRecipeItem.findFirst({
			where: { id: itemId, meal: { mealPlan: { householdId } } },
			select: mealSnapshotSelect.recipeItems.select,
		})
		if (!item) return { status: 'gone' as const }
		const { mealId } = await tx.mealRecipeItem.findUniqueOrThrow({
			where: { id: itemId },
			select: { mealId: true },
		})
		await tx.mealRecipeItem.delete({ where: { id: itemId } })
		const [cards, notes] = await Promise.all([
			tx.mealRecipeItem.count({ where: { mealId } }),
			tx.mealNoteItem.count({ where: { mealId } }),
		])
		if (cards + notes > 0) {
			return {
				status: 'deleted' as const,
				count: 1,
				snapshot: { kind: 'meal-item' as const, item: { ...item, mealId } },
			}
		}
		// The Meal goes with its last card: its snapshot carries the card.
		const result = await deleteMealIn(tx, {
			householdId,
			mealId,
			removeShoppingContributions: false,
		})
		if (result.status === 'deleted' && result.snapshot.kind === 'meal') {
			result.snapshot.meal.recipeItems.push(item)
		}
		return result
	})
}

/** Put one card back in its Meal; `gone` when its Meal has gone or it is back. */
export function restoreMealItem(
	db: Db,
	{ householdId, item }: Scope & { item: z.infer<typeof MealItemSnapshot> },
) {
	return writeTransaction(db, async (tx) => {
		const [meal, existing, recipe, section] = await Promise.all([
			tx.meal.findFirst({
				where: { id: item.mealId, mealPlan: { householdId } },
				select: { id: true },
			}),
			tx.mealRecipeItem.findUnique({
				where: { id: item.id },
				select: { id: true },
			}),
			item.recipeId
				? tx.recipe.findFirst({
						where: { id: item.recipeId, householdId },
						select: { id: true },
					})
				: null,
			item.sectionId
				? tx.mealSection.findFirst({
						where: { id: item.sectionId, mealId: item.mealId },
						select: { id: true },
					})
				: null,
		])
		if (!meal || existing) return { status: 'gone' as const }
		await tx.mealRecipeItem.create({
			data: {
				...item,
				recipeId: recipe ? item.recipeId : null,
				sectionId: section ? item.sectionId : null,
			},
		})
		return { status: 'restored' as const }
	})
}

/** A Staple is only unmarked: its identity stays for anything that uses it. */
export async function removeStaple(
	db: Db,
	{ householdId, stapleId }: Scope & { stapleId: string },
): Promise<DeleteResult> {
	const { count } = await db.householdIngredient.updateMany({
		where: { id: stapleId, householdId, isStaple: true },
		data: { isStaple: false },
	})
	if (count === 0) return { status: 'gone' }
	return {
		status: 'deleted',
		count,
		snapshot: { kind: 'staple', id: stapleId },
	}
}

/**
 * Mark it a Staple again: one added back meanwhile already is, which is what
 * Undo wanted. `gone` when it is not this Household's (or no longer exists).
 */
export async function restoreStaple(
	db: Db,
	{ householdId, stapleId }: Scope & { stapleId: string },
) {
	const { count } = await db.householdIngredient.updateMany({
		where: { id: stapleId, householdId },
		data: { isStaple: true },
	})
	return { status: count === 0 ? ('gone' as const) : ('restored' as const) }
}
