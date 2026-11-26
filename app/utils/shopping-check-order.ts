/**
 * Where each Shopping row shows on a phone while its check moves it: rows to
 * buy, or the Checked group under them. A row checked (or unchecked) on a
 * phone holds its place for half a second, then folds away and arrives at
 * the top of the other group. Nothing here reads the clock: the screen's
 * timers call `holdElapsed`, `foldElapsed` and `arriveElapsed`, and every
 * change to the list (a check answered, a reload, the other phone) goes
 * through `settleMoves`, so a reload can never move a row that still holds.
 */

/** How long a row checked a moment ago keeps its place (ms). */
export const CHECK_HOLD_MS = 500

export type CheckMovePhase =
	/** Inside the half second: the row stays where it was. */
	| 'holding'
	/** The half second is over; the check is not confirmed yet. */
	| 'waiting'
	/** Closing its gap where it was. */
	| 'folding'
	/** Just placed in its new group, opening there. */
	| 'arriving'

export type CheckMove = {
	/** Whether the row showed among the checked rows when it was tapped. */
	from: boolean
	/** The group it goes to, once it starts folding. */
	to?: boolean
	phase: CheckMovePhase
	/** Tells this move's timers from those of an earlier one on the row. */
	seq: number
}

export type CheckMoves = {
	moves: ReadonlyMap<string, CheckMove>
	/** Rows that arrived under Checked this visit, the latest first. */
	arrived: readonly string[]
	seq: number
}

export const NO_MOVES: CheckMoves = { moves: new Map(), arrived: [], seq: 0 }

type Tap = {
	id: string
	/** Whether the row shows among the checked rows now. */
	shownChecked: boolean
	/** Whether the row is checked once this tap is applied. */
	checkedAfterTap: boolean
}

/** A row's check as the screen knows it, for settling moves. */
export type SettleRow = {
	id: string
	/** What the shopper chose. */
	checked: boolean
	/** What is saved: the row stays in this group until a move takes it. */
	resting: boolean
	/** A check for it is still out. */
	pending: boolean
}

function withMove(
	state: CheckMoves,
	id: string,
	move: CheckMove | null,
	arrived = state.arrived,
): CheckMoves {
	const moves = new Map(state.moves)
	if (move) moves.set(id, move)
	else moves.delete(id)
	return { moves, arrived, seq: Math.max(state.seq, move?.seq ?? 0) }
}

function arrive(arrived: readonly string[], id: string, checked: boolean) {
	const others = arrived.filter((other) => other !== id)
	return checked ? [id, ...others] : others
}

/**
 * A tap on a row's check. Starts its hold, or cancels the hold when the tap
 * takes it back to where it shows. A row already folding ignores it.
 */
export function tapRow(state: CheckMoves, tap: Tap): CheckMoves {
	const move = state.moves.get(tap.id)
	if (move?.phase === 'folding') return state
	// A row that has just arrived starts over from where it shows now.
	const existing = move?.phase === 'arriving' ? undefined : move
	const from = existing ? existing.from : tap.shownChecked
	if (tap.checkedAfterTap === from) {
		return existing ? withMove(state, tap.id, null) : state
	}
	return withMove(state, tap.id, {
		from,
		phase: 'holding',
		seq: state.seq + 1,
	})
}

/** The half second is over for the move numbered `seq`. */
export function holdElapsed(state: CheckMoves, id: string, seq: number) {
	const move = state.moves.get(id)
	if (move?.seq !== seq || move.phase !== 'holding') return state
	return withMove(state, id, { ...move, phase: 'waiting' })
}

/** The fold of the move numbered `seq` has run: it opens in its new group. */
export function foldElapsed(state: CheckMoves, id: string, seq: number) {
	const move = state.moves.get(id)
	if (move?.seq !== seq || move.phase !== 'folding') return state
	const to = move.to ?? !move.from
	return withMove(
		state,
		id,
		{ ...move, phase: 'arriving', seq: state.seq + 1 },
		arrive(state.arrived, id, to),
	)
}

/** The row numbered `seq` has opened in its new group: it is settled. */
export function arriveElapsed(state: CheckMoves, id: string, seq: number) {
	const move = state.moves.get(id)
	if (move?.seq !== seq || move.phase !== 'arriving') return state
	return withMove(state, id, null)
}

/**
 * Brings the moves up to date with the list: a row gone from it drops its
 * move, a waiting row whose check is now saved starts folding (or, with
 * reduced motion, goes straight to its new group), and one the server turned
 * back stays where it is. Returns `state` itself when nothing changed.
 */
export function settleMoves(
	state: CheckMoves,
	rows: readonly SettleRow[],
	{ reducedMotion }: { reducedMotion: boolean },
): CheckMoves {
	if (state.moves.size === 0) return state
	const byId = new Map(rows.map((row) => [row.id, row]))
	let next = state
	for (const [id, move] of state.moves) {
		const row = byId.get(id)
		if (!row) {
			next = withMove(next, id, null)
			continue
		}
		if (move.phase !== 'waiting') continue
		if (row.resting !== move.from) {
			next = reducedMotion
				? withMove(next, id, null, arrive(next.arrived, id, row.resting))
				: withMove(next, id, {
						...move,
						to: row.resting,
						phase: 'folding',
						seq: next.seq + 1,
					})
		} else if (row.checked === move.from && !row.pending) {
			next = withMove(next, id, null)
		}
	}
	return next
}

export type PlacedRow<T> = {
	item: T
	/** Closing its gap where it was. */
	folding: boolean
	/** Just arrived in this group. */
	arriving: boolean
}

const isBeingAdded = (id: string) => id.startsWith('optimistic:')

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * Splits the rows into the ones to buy and the checked ones. A row with a
 * move shows where it was until it has folded; every other row shows by its
 * saved check (`resting`). Rows to buy go by name, with rows still being
 * added after them. Checked rows that arrived this visit come first, the
 * latest on top, then the rest by name.
 */
export function placeShoppingRows<
	T extends { id: string; name: string; checked: boolean },
>(
	items: readonly T[],
	state: CheckMoves,
	resting: (item: T) => boolean,
): { open: PlacedRow<T>[]; done: PlacedRow<T>[] } {
	const open: PlacedRow<T>[] = []
	const adding: PlacedRow<T>[] = []
	const done: PlacedRow<T>[] = []
	for (const item of items) {
		const move = state.moves.get(item.id)
		const placed = {
			item,
			folding: move?.phase === 'folding',
			arriving: move?.phase === 'arriving',
		}
		const checked =
			move && move.phase !== 'arriving' ? move.from : resting(item)
		if (checked) done.push(placed)
		else if (isBeingAdded(item.id)) adding.push(placed)
		else open.push(placed)
	}
	open.sort((a, b) => byName(a.item, b.item))
	const arrivedAt = new Map(state.arrived.map((id, index) => [id, index]))
	done.sort((a, b) => {
		const ai = arrivedAt.get(a.item.id)
		const bi = arrivedAt.get(b.item.id)
		if (ai !== undefined || bi !== undefined)
			return (ai ?? Infinity) - (bi ?? Infinity)
		return byName(a.item, b.item)
	})
	return { open: [...open, ...adding], done }
}

/**
 * What Clear checked takes: the rows showing under Checked whose check is
 * saved. A row still holding among the rows to buy is not one of them.
 */
export function clearableRows<T extends { id: string; checked: boolean }>(
	done: ReadonlyArray<PlacedRow<T>>,
	pendingIds: ReadonlySet<string>,
): T[] {
	return done
		.map((entry) => entry.item)
		.filter((item) => item.checked && !pendingIds.has(item.id))
}
