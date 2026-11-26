import { describe, expect, test } from 'vitest'
import {
	arriveElapsed,
	clearableRows,
	foldElapsed,
	holdElapsed,
	NO_MOVES,
	placeShoppingRows,
	settleMoves,
	tapRow,
	type CheckMoves,
} from './shopping-check-order.ts'

type Row = { id: string; name: string; checked: boolean }
/** What a row's check is, as saved; `checked` is what the shopper chose. */
type Saved = { resting: boolean; pending: boolean }

function list(...rows: Array<[name: string, checked?: boolean]>): Row[] {
	return rows.map(([name, checked = false]) => ({
		id: name,
		name,
		checked,
	}))
}

/** Every row saved as shown unless `saved` says otherwise. */
function savedState(rows: Row[], saved: Record<string, Partial<Saved>> = {}) {
	return rows.map((row) => ({
		id: row.id,
		checked: row.checked,
		resting: saved[row.id]?.resting ?? row.checked,
		pending: saved[row.id]?.pending ?? false,
	}))
}

function place(
	rows: Row[],
	state: CheckMoves,
	saved: Record<string, Partial<Saved>> = {},
) {
	const placed = placeShoppingRows(
		rows,
		state,
		(row) => saved[row.id]?.resting ?? row.checked,
	)
	return {
		open: placed.open.map((entry) => entry.item.name),
		done: placed.done.map((entry) => entry.item.name),
		folding: [...placed.open, ...placed.done]
			.filter((entry) => entry.folding)
			.map((entry) => entry.item.name),
		arriving: [...placed.open, ...placed.done]
			.filter((entry) => entry.arriving)
			.map((entry) => entry.item.name),
	}
}

function seqOf(state: CheckMoves, id: string) {
	return state.moves.get(id)!.seq
}

/** Taps a row to checked and runs its hold out, with its check saved. */
function checkAndMove(state: CheckMoves, rows: Row[], id: string) {
	let next = tapRow(state, { id, shownChecked: false, checkedAfterTap: true })
	next = holdElapsed(next, id, seqOf(next, id))
	const after = rows.map((row) =>
		row.id === id ? { ...row, checked: true } : row,
	)
	next = settleMoves(next, savedState(after), { reducedMotion: false })
	next = foldElapsed(next, id, seqOf(next, id))
	next = arriveElapsed(next, id, seqOf(next, id))
	return { state: next, rows: after }
}

describe('a row checked off on a phone', () => {
	test('stays among the rows to buy while it holds, even once its check is saved', () => {
		const state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const checked = list(['apples'], ['bread', true], ['rice'])
		expect(place(checked, state)).toEqual({
			open: ['apples', 'bread', 'rice'],
			done: [],
			folding: [],
			arriving: [],
		})
	})

	test('keeps its place when the list reloads with rows added, removed and changed', () => {
		const state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		// A refresh: apples gone, cheese added on the other phone, rice checked
		// there too.
		const reloaded = list(['bread', true], ['cheese'], ['rice', true])
		const settled = settleMoves(state, savedState(reloaded), {
			reducedMotion: false,
		})
		expect(place(reloaded, settled)).toEqual({
			open: ['bread', 'cheese'],
			done: ['rice'],
			folding: [],
			arriving: [],
		})
	})

	test('does not move when the hold ends while its check is still unconfirmed', () => {
		const rows = list(['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		const saved = { bread: { resting: false, pending: true } }
		state = settleMoves(state, savedState(rows, saved), {
			reducedMotion: false,
		})
		expect(place(rows, state, saved)).toEqual({
			open: ['bread', 'rice'],
			done: [],
			folding: [],
			arriving: [],
		})
	})

	test('folds where it was once the hold has ended and its check is saved', () => {
		const rows = list(['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(place(rows, state)).toEqual({
			open: ['bread', 'rice'],
			done: [],
			folding: ['bread'],
			arriving: [],
		})
	})

	test('a check confirmed after the hold ended still folds, rather than jumping', () => {
		const rows = list(['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(
			state,
			savedState(rows, { bread: { resting: false, pending: true } }),
			{ reducedMotion: false },
		)
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(place(rows, state).folding).toEqual(['bread'])
	})

	test('arrives at the top of Checked after the fold', () => {
		const rows = list(['apples', true], ['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		state = foldElapsed(state, 'bread', seqOf(state, 'bread'))
		expect(place(rows, state)).toEqual({
			open: ['rice'],
			done: ['bread', 'apples'],
			folding: [],
			arriving: ['bread'],
		})
		state = arriveElapsed(state, 'bread', seqOf(state, 'bread'))
		expect(place(rows, state)).toEqual({
			open: ['rice'],
			done: ['bread', 'apples'],
			folding: [],
			arriving: [],
		})
	})

	test('stays at the top of Checked when the list reloads in its saved order', () => {
		const start = list(['apples', true], ['bread'], ['rice'])
		const moved = checkAndMove(NO_MOVES, start, 'bread')
		// The loader sorts checked rows by name: apples, bread.
		const reloaded = list(['rice'], ['apples', true], ['bread', true])
		expect(place(reloaded, moved.state).done).toEqual(['bread', 'apples'])
	})

	test('rows arriving later go above earlier ones, and rows checked elsewhere follow by name', () => {
		const start = list(['apples'], ['bread'], ['eggs'], ['rice'])
		let { state, rows } = checkAndMove(NO_MOVES, start, 'rice')
		;({ state, rows } = checkAndMove(state, rows, 'apples'))
		// Checked on the other phone: no move of its own here.
		rows = rows.map((row) =>
			row.id === 'eggs' || row.id === 'bread' ? { ...row, checked: true } : row,
		)
		expect(place(rows, state).done).toEqual(['apples', 'rice', 'bread', 'eggs'])
	})
})

describe('taps while a row holds', () => {
	test('a second tap inside the half second cancels the move and leaves the row where it is', () => {
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const seq = seqOf(state, 'bread')
		state = tapRow(state, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: false,
		})
		expect(state.moves.has('bread')).toBe(false)
		// The cancelled hold's timer still fires, and changes nothing.
		const after = holdElapsed(state, 'bread', seq)
		const rows = list(['bread'], ['rice'])
		expect(place(rows, after).open).toEqual(['bread', 'rice'])
		expect(after.moves.has('bread')).toBe(false)
	})

	test('a tap after the hold ended, before the check was confirmed, also cancels it', () => {
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = tapRow(state, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: false,
		})
		expect(state.moves.has('bread')).toBe(false)
	})

	test('three rows checked together each keep their own hold, and unchecking one leaves the other two to move', () => {
		let state = NO_MOVES
		for (const id of ['apples', 'bread', 'rice'])
			state = tapRow(state, { id, shownChecked: false, checkedAfterTap: true })
		const breadSeq = seqOf(state, 'bread')
		state = tapRow(state, {
			id: 'apples',
			shownChecked: false,
			checkedAfterTap: false,
		})
		// Only bread's hold has run out.
		state = holdElapsed(state, 'bread', breadSeq)
		const rows = list(['apples'], ['bread', true], ['rice', true])
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(place(rows, state)).toEqual({
			open: ['apples', 'bread', 'rice'],
			done: [],
			folding: ['bread'],
			arriving: [],
		})
		state = holdElapsed(state, 'rice', seqOf(state, 'rice'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		state = foldElapsed(state, 'bread', seqOf(state, 'bread'))
		expect(place(rows, state)).toEqual({
			open: ['apples', 'rice'],
			done: ['bread'],
			folding: ['rice'],
			arriving: ['bread'],
		})
	})

	test('a timer left from an earlier hold does nothing to a new hold on the same row', () => {
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const firstSeq = seqOf(state, 'bread')
		state = tapRow(state, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: false,
		})
		state = tapRow(state, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', firstSeq)
		expect(state.moves.get('bread')?.phase).toBe('holding')
	})

	test('a tap on a folding row changes nothing', () => {
		const rows = list(['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		const folding = state
		state = tapRow(state, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: false,
		})
		expect(state).toBe(folding)
	})

	test('a tap that leaves the row in the group it shows in starts no move', () => {
		// An unconfirmed uncheck, tapped back to checked: it was never moved.
		const state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: true,
			checkedAfterTap: true,
		})
		expect(state).toBe(NO_MOVES)
	})
})

describe('unchecking a row under Checked', () => {
	test('holds it there, then sends it back to its place by name', () => {
		const start = list(['apples'], ['bread'], ['rice'])
		const moved = checkAndMove(NO_MOVES, start, 'bread')
		let state = tapRow(moved.state, {
			id: 'bread',
			shownChecked: true,
			checkedAfterTap: false,
		})
		const rows = list(['apples'], ['bread'], ['rice'])
		expect(place(rows, state).done).toEqual(['bread'])
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(place(rows, state).folding).toEqual(['bread'])
		state = foldElapsed(state, 'bread', seqOf(state, 'bread'))
		expect(place(rows, state)).toEqual({
			open: ['apples', 'bread', 'rice'],
			done: [],
			folding: [],
			arriving: ['bread'],
		})
		// Checked again later, it arrives on top again rather than in an old slot.
		expect(state.arrived).not.toContain('bread')
	})
})

describe('a row tapped again as it arrives', () => {
	test('holds again from where it shows now', () => {
		const rows = list(['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		state = foldElapsed(state, 'bread', seqOf(state, 'bread'))
		state = tapRow(state, {
			id: 'bread',
			shownChecked: true,
			checkedAfterTap: false,
		})
		const unchecked = list(['bread'], ['rice'])
		expect(place(unchecked, state, { bread: { resting: true } }).done).toEqual([
			'bread',
		])
		expect(state.moves.get('bread')?.phase).toBe('holding')
	})
})

describe('the list changing under a held row', () => {
	test('a row deleted elsewhere while it holds is dropped and never placed', () => {
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const rows = list(['rice'])
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(state.moves.has('bread')).toBe(false)
		expect(place(rows, state)).toEqual({
			open: ['rice'],
			done: [],
			folding: [],
			arriving: [],
		})
	})

	test('a check the server turned back while the row waited leaves the row where it was', () => {
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		// The other phone changed the amount: the check is refused, and the row
		// shows unchecked again.
		const rows = list(['bread'], ['rice'])
		state = settleMoves(state, savedState(rows), { reducedMotion: false })
		expect(state.moves.has('bread')).toBe(false)
		expect(place(rows, state).open).toEqual(['bread', 'rice'])
	})

	test('a row being added stays at the end of the rows to buy, below a held checked row', () => {
		const state = tapRow(NO_MOVES, {
			id: 'rice',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const rows: Row[] = [
			...list(['apples'], ['rice', true], ['milk', true]),
			{ id: 'optimistic:bananas', name: 'bananas', checked: false },
		]
		expect(place(rows, state)).toEqual({
			open: ['apples', 'rice', 'bananas'],
			done: ['milk'],
			folding: [],
			arriving: [],
		})
	})

	test('settling with nothing to change returns the same state', () => {
		const rows = list(['bread', true], ['rice'])
		const holding = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		expect(
			settleMoves(holding, savedState(rows), { reducedMotion: false }),
		).toBe(holding)
		expect(
			settleMoves(NO_MOVES, savedState(rows), { reducedMotion: false }),
		).toBe(NO_MOVES)
	})
})

describe('reduced motion', () => {
	test('the row moves when the hold ends, without folding', () => {
		const rows = list(['apples', true], ['bread', true], ['rice'])
		let state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		state = holdElapsed(state, 'bread', seqOf(state, 'bread'))
		state = settleMoves(state, savedState(rows), { reducedMotion: true })
		expect(place(rows, state)).toEqual({
			open: ['rice'],
			done: ['bread', 'apples'],
			folding: [],
			arriving: [],
		})
	})
})

describe('Clear checked', () => {
	test('takes only the rows under Checked, never a held row or an unconfirmed one', () => {
		const rows = list(['apples', true], ['bread', true], ['eggs', true])
		const state = tapRow(NO_MOVES, {
			id: 'bread',
			shownChecked: false,
			checkedAfterTap: true,
		})
		const saved = {
			bread: { resting: false },
			eggs: { resting: true, pending: true },
		}
		const placed = placeShoppingRows(
			rows,
			state,
			(row) => saved[row.id as 'bread' | 'eggs']?.resting ?? row.checked,
		)
		expect(
			clearableRows(placed.done, new Set(['eggs'])).map((row) => row.id),
		).toEqual(['apples'])
	})
})
