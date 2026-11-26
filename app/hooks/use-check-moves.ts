// The half-second hold and fold of a Shopping row whose check changed on a
// phone (app/utils/shopping-check-order.ts holds the rules).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	arriveElapsed,
	CHECK_HOLD_MS,
	foldElapsed,
	holdElapsed,
	NO_MOVES,
	settleMoves,
	tapRow,
	type CheckMoves,
	type SettleRow,
} from '#app/utils/shopping-check-order.ts'

/** RowCollapse's settle: a little over its fold (tailwind.css). */
const FOLD_MS = 260

/** Below `md`, where Shopping groups its checked rows under Checked. */
const PHONE_QUERY = '(width < 48rem)'

const matches = (query: string) =>
	typeof window !== 'undefined' &&
	typeof window.matchMedia === 'function' &&
	window.matchMedia(query).matches

/**
 * The moves of rows whose check changed, with their timers. `rows` is every
 * row on the list as the checks know it; each render settles the moves
 * against it, so an answer, a reload or the other phone changes a move only
 * through `settleMoves`. Wider than a phone a tap starts no move, and rows
 * show by their saved check as they always have.
 */
export function useCheckMoves(rows: readonly SettleRow[]) {
	const [state, setState] = useState<CheckMoves>(NO_MOVES)

	// `rows` is new on each render; settling returns the same state when
	// nothing changed, so this stops there.
	useEffect(() => {
		setState((current) =>
			settleMoves(current, rows, {
				reducedMotion: matches('(prefers-reduced-motion: reduce)'),
			}),
		)
	}, [rows])

	// One timer per move, for the phase it is in.
	const timers = useRef(new Map<string, { seq: number; handle: number }>())
	useEffect(() => {
		const live = timers.current
		for (const [id, timer] of live) {
			if (state.moves.get(id)?.seq !== timer.seq) {
				window.clearTimeout(timer.handle)
				live.delete(id)
			}
		}
		for (const [id, move] of state.moves) {
			if (move.phase === 'waiting' || live.get(id)?.seq === move.seq) continue
			const [ms, elapse] =
				move.phase === 'holding'
					? [CHECK_HOLD_MS, holdElapsed]
					: move.phase === 'folding'
						? [FOLD_MS, foldElapsed]
						: [FOLD_MS, arriveElapsed]
			const handle = window.setTimeout(() => {
				live.delete(id)
				setState((current) => elapse(current, id, move.seq))
			}, ms)
			live.set(id, { seq: move.seq, handle })
		}
	}, [state.moves])
	useEffect(() => {
		const live = timers.current
		return () => {
			for (const timer of live.values()) window.clearTimeout(timer.handle)
			live.clear()
		}
	}, [])

	const tap = useCallback(
		(id: string, shownChecked: boolean, checkedAfterTap: boolean) => {
			if (!matches(PHONE_QUERY)) return
			setState((current) =>
				tapRow(current, { id, shownChecked, checkedAfterTap }),
			)
		},
		[],
	)

	return { state, tap }
}
