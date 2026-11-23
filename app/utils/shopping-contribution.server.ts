import { createId } from '@paralleldrive/cuid2'
import { type Prisma, type PrismaClient } from '#app/generated/prisma/client.ts'
import {
	demandIdentity,
	type ShoppingDemandLine,
} from './shopping-demand.server.ts'
import { parseAmount } from './fractions.ts'
import { selectNextShopDemandTargets } from './shopping-horizon.server.ts'
import { LATER, NEXT_SHOP } from './shopping-horizon.ts'
import { guessCategory } from './shopping-list-validation.ts'
import { keepsOwnAmount } from './shopping-row-source.ts'
import { writeTransaction } from './write-transaction.server.ts'

type Tx = Prisma.TransactionClient

/**
 * Transactional contribution reconciliation — the second internal seam that
 * consumes buildShoppingDemand output (#108). It records one current-state
 * MealShoppingContribution per (Meal, canonical demand identity) between the
 * source Meal and the displayed Shopping row its demand feeds. NOT an event
 * ledger: re-adding is idempotent, no history accumulates. Manual Shopping
 * rows stay durable manual rows — a matching row is only pointed at, never
 * rewritten. replaceMealShoppingContributions handles an explicit update.
 */
export function reconcileMealShoppingContributions(
	db: PrismaClient,
	args: ReconcileMealShoppingContributionsArgs,
): Promise<ReconcileMealShoppingContributionsResult> {
	return writeTransaction(db, (tx) =>
		reconcileMealShoppingContributionsInTransaction(tx, args),
	)
}

type ReconcileMealShoppingContributionsArgs = {
	mealId: string
	listId: string
	/** Demand lines after availability annotation (Staples already gone). */
	lines: ShoppingDemandLine[]
}

type ReconcileMealShoppingContributionsResult = {
	/** New Shopping rows created. */
	createdRowCount: number
	/** Demand recorded against an already-displayed row (no visual change). */
	attachedCount: number
	/** Demand this Meal had already contributed — left untouched. */
	alreadyContributedCount: number
	/** Unchecked Later rows promoted in place for this generated demand. */
	promotedRowCount: number
}

/**
 * `reconcileMealShoppingContributions` inside a transaction the caller holds
 * with `writeTransaction`, so it can read the Meal's demand under the same
 * lock: a Meal deleted or cooked meanwhile can't slip in between.
 */
export async function reconcileMealShoppingContributionsInTransaction(
	tx: Tx,
	{ mealId, listId, lines }: ReconcileMealShoppingContributionsArgs,
): Promise<ReconcileMealShoppingContributionsResult> {
	// The rows are read and written in one transaction that holds the write
	// lock, so a check, a delete or another add of this Meal lands wholly
	// before or wholly after, never between the read and the writes.
	const existingItems = await tx.shoppingListItem.findMany({
		where: { listId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			name: true,
			checked: true,
			horizon: true,
		},
	})
	const existingContributions = await tx.mealShoppingContribution.findMany({
		where: { mealId },
		select: { canonicalName: true, itemId: true },
	})

	const itemById = new Map(existingItems.map((item) => [item.id, item]))
	const targetByCanonical = selectNextShopDemandTargets(
		existingItems,
		lines.map((line) => line.canonicalName),
	)
	const contributionByCanonical = new Map(
		existingContributions.map((c) => [c.canonicalName, c]),
	)
	const promote = promoter(tx)

	let createdRowCount = 0
	let attachedCount = 0
	let alreadyContributedCount = 0
	const seen = new Set<string>()

	for (const line of lines) {
		// Respect the (mealId, canonicalName) identity within one call too.
		if (seen.has(line.canonicalName)) continue
		seen.add(line.canonicalName)

		const contributed = contributionByCanonical.get(line.canonicalName)
		if (contributed) {
			// Current-state record already exists — this is not a refresh (#110).
			await promote(itemById.get(contributed.itemId))
			alreadyContributedCount++
			continue
		}

		const existingRow = targetByCanonical.get(line.canonicalName)
		if (existingRow) {
			await promote(existingRow)
			// A compatible row is already displayed (manual or generated) —
			// record provenance against it without creating a visual
			// duplicate or rewriting the row.
			await tx.mealShoppingContribution.create({
				data: contributionData(mealId, line, existingRow.id),
			})
			attachedCount++
		} else {
			await createMealRow(tx, { mealId, listId, line })
			createdRowCount++
		}
	}

	return {
		createdRowCount,
		attachedCount,
		alreadyContributedCount,
		promotedRowCount: promote.count(),
	}
}

/**
 * Whether `next` is plainly more than `previous`: the same unit and two
 * amounts that read as numbers. Anything that can't be compared counts as
 * not larger.
 */
function isLarger(
	next: { quantity: string | null; unit: string | null },
	previous: { quantity: string | null; unit: string | null },
) {
	const unit = (value: string | null) => value?.trim().toLowerCase() ?? ''
	if (unit(next.unit) !== unit(previous.unit)) return false
	const after = next.quantity ? parseAmount(next.quantity) : null
	const before = previous.quantity ? parseAmount(previous.quantity) : null
	return after != null && before != null && after > before
}

/** Move an unchecked Later row to Next shop once, for new generated demand. */
function promoter(tx: Tx) {
	const promotedIds = new Set<string>()
	const promote = async (
		item: { id: string; checked: boolean; horizon: string } | undefined,
	) => {
		if (!item || item.checked || item.horizon !== LATER) return
		if (promotedIds.has(item.id)) return
		promotedIds.add(item.id)
		await tx.shoppingListItem.update({
			where: { id: item.id },
			data: { horizon: NEXT_SHOP },
		})
	}
	promote.count = () => promotedIds.size
	return promote
}

function contributionData(
	mealId: string,
	line: ShoppingDemandLine,
	itemId: string,
) {
	return {
		id: createId(),
		mealId,
		itemId,
		canonicalName: line.canonicalName,
		name: line.name,
		quantity: line.quantity,
		unit: line.unit,
	}
}

/** A new unchecked Next shop row holding one line of this Meal's demand. */
async function createMealRow(
	tx: Tx,
	{
		mealId,
		listId,
		line,
	}: { mealId: string; listId: string; line: ShoppingDemandLine },
) {
	const itemId = createId()
	await tx.shoppingListItem.create({
		data: {
			id: itemId,
			listId,
			name: line.name,
			quantity: line.quantity,
			unit: line.unit,
			category: line.category,
			checked: false,
			source: 'meal',
			horizon: NEXT_SHOP,
		},
	})
	await tx.mealShoppingContribution.create({
		data: contributionData(mealId, line, itemId),
	})
}

/**
 * Replace one Meal's current contribution with freshly built demand. Existing
 * unchecked display rows are reused; rows created for demand that no longer
 * exists disappear only when no manual or other-Meal component still needs
 * them. Newly introduced groups start unchecked even when the ordinary
 * initial-add availability seam would have pre-checked them.
 *
 * A checked row is a purchase, so Update leaves it alone. Whether this
 * Meal's demand on it grew, shrank or went away, the row and the share stay
 * as they are and nothing is added elsewhere for that ingredient. Such rows
 * are reported so the person knows. Once the row is unchecked, the next
 * Update applies the new amount to it.
 */
export function replaceMealShoppingContributions(
	db: PrismaClient,
	args: ReplaceMealShoppingContributionsArgs,
): Promise<ReplaceMealShoppingContributionsResult> {
	return writeTransaction(db, (tx) =>
		replaceMealShoppingContributionsInTransaction(tx, args),
	)
}

type ReplaceMealShoppingContributionsArgs = {
	mealId: string
	listId: string
	lines: ShoppingDemandLine[]
	/**
	 * Identities whose existing contribution stays exactly as it is, neither
	 * updated nor withdrawn. These are the ones a cooked item needs.
	 */
	keepIdentities?: ReadonlySet<string>
	/**
	 * Never withdraw or lower an existing contribution, though a larger
	 * amount still applies (see `cookedRecipeGone`).
	 */
	neverLower?: boolean
}

type ReplaceMealShoppingContributionsResult = {
	createdRowCount: number
	attachedCount: number
	updatedContributionCount: number
	removedContributionCount: number
	promotedRowCount: number
	/** Checked rows whose share from this Meal would have changed. */
	skippedCheckedNames: string[]
}

/**
 * `replaceMealShoppingContributions` inside a transaction the caller holds
 * with `writeTransaction`, so it can read the Meal's demand under the same
 * lock.
 */
export async function replaceMealShoppingContributionsInTransaction(
	tx: Tx,
	{
		mealId,
		listId,
		lines,
		keepIdentities = new Set(),
		neverLower = false,
	}: ReplaceMealShoppingContributionsArgs,
): Promise<ReplaceMealShoppingContributionsResult> {
	const existingItems = await tx.shoppingListItem.findMany({
		where: { listId },
		orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
		select: {
			id: true,
			name: true,
			source: true,
			checked: true,
			horizon: true,
		},
	})
	const existingContributions = await tx.mealShoppingContribution.findMany({
		where: { mealId },
		select: {
			id: true,
			itemId: true,
			canonicalName: true,
			name: true,
			quantity: true,
			unit: true,
		},
	})

	const rowById = new Map(existingItems.map((item) => [item.id, item]))
	const rowByCanonical = selectNextShopDemandTargets(
		existingItems,
		lines.map((line) => line.canonicalName),
	)
	const contributionByCanonical = new Map(
		existingContributions.map((contribution) => [
			contribution.canonicalName,
			contribution,
		]),
	)
	const freshByCanonical = new Map<string, ShoppingDemandLine>()
	for (const line of lines) {
		if (!freshByCanonical.has(line.canonicalName)) {
			freshByCanonical.set(line.canonicalName, line)
		}
	}

	const promote = promoter(tx)
	let createdRowCount = 0
	let attachedCount = 0
	let updatedContributionCount = 0
	let removedContributionCount = 0
	const possiblyEmptyMealRows = new Set<string>()
	// One name per row, however many of this Meal's shares sit on it.
	const skippedChecked = new Map<string, string>()

	// New demand reuses only an outstanding row (Next shop first, a Later
	// row moves up) or gets its own row, the #226 rule for every Meal add.
	async function placeNewDemand(line: ShoppingDemandLine) {
		const existingRow = rowByCanonical.get(line.canonicalName)
		if (existingRow) {
			await promote(existingRow)
			await tx.mealShoppingContribution.create({
				data: contributionData(mealId, line, existingRow.id),
			})
			return 'attached' as const
		}
		await createMealRow(tx, { mealId, listId, line })
		return 'created' as const
	}

	for (const contribution of existingContributions) {
		if (keepIdentities.has(contribution.canonicalName)) continue
		const line = freshByCanonical.get(contribution.canonicalName)
		const row = rowById.get(contribution.itemId)
		const changed =
			!line ||
			contribution.name !== line.name ||
			contribution.quantity !== line.quantity ||
			contribution.unit !== line.unit
		if (neverLower && changed && !(line && isLarger(line, contribution))) {
			continue
		}

		if (row?.checked) {
			// A checked row is a purchase. Update leaves it and this Meal's
			// share on it alone, and adds nothing elsewhere for it, until
			// someone unchecks the row.
			if (changed) skippedChecked.set(row.id, row.name)
			continue
		}

		if (!line) {
			await tx.mealShoppingContribution.delete({
				where: { id: contribution.id },
			})
			possiblyEmptyMealRows.add(contribution.itemId)
			removedContributionCount++
			continue
		}

		if (changed) {
			await tx.mealShoppingContribution.update({
				where: { id: contribution.id },
				data: {
					name: line.name,
					quantity: line.quantity,
					unit: line.unit,
				},
			})
			updatedContributionCount++
		}

		await promote(row)
		if (row?.source === 'meal') {
			await tx.shoppingListItem.update({
				where: { id: row.id },
				data: {
					name: line.name,
					quantity: line.quantity,
					unit: line.unit,
					category: line.category,
				},
			})
		}
	}

	for (const line of freshByCanonical.values()) {
		if (contributionByCanonical.has(line.canonicalName)) continue
		if ((await placeNewDemand(line)) === 'attached') attachedCount++
		else createdRowCount++
	}

	if (possiblyEmptyMealRows.size > 0) {
		await tx.shoppingListItem.deleteMany({
			where: {
				id: { in: [...possiblyEmptyMealRows] },
				source: 'meal',
				mealContributions: { none: {} },
			},
		})
	}

	return {
		createdRowCount,
		attachedCount,
		updatedContributionCount,
		removedContributionCount,
		promotedRowCount: promote.count(),
		skippedCheckedNames: [...skippedChecked.values()],
	}
}

/**
 * What a row Edit or Remove generated amount did. `conflict`: the row changed
 * since the person saw it (its version moved after new Meal demand, a check
 * or an edit), so nothing was written. `missing`: no such row in this Household.
 */
export type ShoppingRowWriteResult = {
	status: 'success' | 'conflict' | 'missing'
}

/**
 * Read one row of the Household inside a write transaction and confirm it is
 * still at the version the person saw. The transaction holds the write lock,
 * so the row cannot change again before this write commits.
 */
async function readRowAtVersion(
	tx: Tx,
	{
		householdId,
		itemId,
		observedVersion,
	}: { householdId: string; itemId: string; observedVersion: number },
) {
	const item = await tx.shoppingListItem.findFirst({
		where: { id: itemId, list: { householdId } },
		include: { mealContributions: { orderBy: { id: 'asc' } } },
	})
	if (!item) return { status: 'missing' as const }
	if (item.checkVersion !== observedVersion) {
		return { status: 'conflict' as const }
	}
	return { status: 'current' as const, item }
}

/**
 * Edit one displayed Shopping group without letting later Meal refreshes
 * overwrite the user's correction. Generated-only groups become one manual
 * row and shed every represented contribution. A mixed group's own component
 * (a typed or Recipe-detail row's amount) alone is edited; if its name moves
 * to another identity, the generated component goes back to an unchecked
 * row of its own ingredient, or a new one.
 *
 * The edit applies only at the version the person saw. Otherwise it would
 * drop Meal demand that joined since, or change a row someone just checked.
 */
export function editShoppingDisplayGroup(
	db: PrismaClient,
	{
		householdId,
		itemId,
		observedVersion,
		name,
		quantity,
		unit,
	}: {
		householdId: string
		itemId: string
		observedVersion: number
		name: string
		quantity: string | null
		unit: string | null
	},
): Promise<ShoppingRowWriteResult> {
	return writeTransaction(db, async (tx) => {
		const read = await readRowAtVersion(tx, {
			householdId,
			itemId,
			observedVersion,
		})
		if (read.status !== 'current') return { status: read.status }
		const { item } = read

		const generatedOnly = !keepsOwnAmount(item.source)
		// The row's own write goes first and carries the version, because the
		// contribution writes below advance it.
		const written = await tx.shoppingListItem.updateMany({
			where: { id: item.id, checkVersion: observedVersion },
			data: generatedOnly
				? { name, quantity, unit, source: 'manual' }
				: { name, quantity, unit },
		})
		if (written.count === 0) return { status: 'conflict' }

		if (generatedOnly) {
			await tx.mealShoppingContribution.deleteMany({
				where: { itemId: item.id },
			})
			return { status: 'success' }
		}

		const oldIdentity = demandIdentity(item.name)
		const newIdentity = demandIdentity(name)
		if (item.mealContributions.length === 0 || oldIdentity === newIdentity) {
			return { status: 'success' }
		}

		// The share goes back to an outstanding row of its own ingredient, by
		// the same rule as new Meal demand, so a checked purchase never grows.
		const otherRows = await tx.shoppingListItem.findMany({
			where: { listId: item.listId, id: { not: item.id } },
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
			select: { id: true, name: true, checked: true, horizon: true },
		})
		const targetByIdentity = selectNextShopDemandTargets(
			otherRows,
			item.mealContributions.map((c) => c.canonicalName),
		)

		const contributionsByIdentity = new Map<
			string,
			typeof item.mealContributions
		>()
		for (const contribution of item.mealContributions) {
			const group =
				contributionsByIdentity.get(contribution.canonicalName) ?? []
			group.push(contribution)
			contributionsByIdentity.set(contribution.canonicalName, group)
		}
		for (const [identity, contributions] of contributionsByIdentity) {
			let targetId = targetByIdentity.get(identity)?.id
			if (!targetId) {
				targetId = createId()
				const first = contributions[0]!
				await tx.shoppingListItem.create({
					data: {
						id: targetId,
						listId: item.listId,
						name: first.name,
						quantity: first.quantity,
						unit: first.unit,
						category: guessCategory(first.name),
						checked: false,
						source: 'meal',
						horizon: item.horizon,
					},
				})
			}
			await tx.mealShoppingContribution.updateMany({
				where: { id: { in: contributions.map((entry) => entry.id) } },
				data: { itemId: targetId },
			})
		}
		return { status: 'success' }
	})
}

/**
 * Remove only the generated component of a mixed group, meaning a typed or
 * Recipe-detail row that Meal demand joined. It applies only at the version
 * the person saw, so Meal demand that joined since is not removed unseen.
 */
export function removeGeneratedShoppingAmount(
	db: PrismaClient,
	{
		householdId,
		itemId,
		observedVersion,
	}: { householdId: string; itemId: string; observedVersion: number },
): Promise<
	{ status: 'success'; name: string } | { status: 'conflict' | 'missing' }
> {
	return writeTransaction(db, async (tx) => {
		const read = await readRowAtVersion(tx, {
			householdId,
			itemId,
			observedVersion,
		})
		if (read.status !== 'current') return { status: read.status }
		const { item } = read
		if (!keepsOwnAmount(item.source) || item.mealContributions.length === 0) {
			return { status: 'missing' as const }
		}
		await tx.mealShoppingContribution.deleteMany({ where: { itemId } })
		return { status: 'success' as const, name: item.name }
	})
}
