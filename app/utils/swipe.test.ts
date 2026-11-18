import { describe, expect, test } from 'vitest'
import {
	lockAxis,
	releaseVelocity,
	rubberBand,
	settleReveal,
	settleCommit,
	settleDismiss,
	sheetDragIntent,
} from './swipe.ts'

// Failure list, written before swipe.ts:
// axis lock — no decision inside the slop; a mostly-horizontal move takes the
//   x axis; a mostly-vertical one leaves it to scrolling; a diagonal tie goes
//   to scrolling so a slanted scroll never opens a row.
// rubber band — inside the range the finger is followed 1:1; past either end
//   the travel shrinks, the further the more it resists, and never reverses.
// reveal settle (Shopping row) — a short slow drag stays shut; a drag past
//   half opens; a short fast flick opens; from open, a drag back past half
//   or a flick back closes; a flick against a long drag wins; a drag the
//   wrong way from shut stays shut.
// release velocity — a steady drag reads its speed; a finger held still
//   before lifting reads as still (iOS sends no moves while it rests); two
//   moves a moment apart at the end don't read as a flick; a short drag
//   never flicks however fast; no moves read as still.
// commit settle (Plan week) — a short slow drag snaps back; past the
//   distance threshold commits that way; a flick commits; a flick against
//   the drag cancels.
// sheet drag intent (BottomSheet) — no decision inside the slop; a pull down
//   with the content at its top drags the sheet; a pull down with the content
//   scrolled scrolls it back; a push up scrolls content that can scroll; a
//   push up on content that can't scroll drags the sheet (and resists); a
//   sideways move is not the sheet's.
// dismiss settle (BottomSheet) — a short slow pull stays; a pull past the
//   threshold dismisses; a short fast flick down dismisses; a flick up after
//   a long pull stays; a sheet pushed up stays.

describe('lockAxis', () => {
	test('waits until the finger has moved past the slop', () => {
		expect(lockAxis(5, 3)).toBeNull()
	})
	test('takes the x axis for a mostly horizontal move', () => {
		expect(lockAxis(-12, 4)).toBe('x')
	})
	test('leaves a mostly vertical move to scrolling', () => {
		expect(lockAxis(4, -14)).toBe('y')
	})
	test('gives a diagonal tie to scrolling', () => {
		expect(lockAxis(10, 10)).toBe('y')
	})
})

describe('rubberBand', () => {
	test('follows the finger inside the range', () => {
		expect(rubberBand(-60, -144, 0)).toBe(-60)
	})
	test('shrinks travel past the far end', () => {
		const past = rubberBand(-244, -144, 0)
		expect(past).toBeLessThan(-144)
		expect(past).toBeGreaterThan(-244)
	})
	test('shrinks travel past the near end', () => {
		const past = rubberBand(50, -144, 0)
		expect(past).toBeGreaterThan(0)
		expect(past).toBeLessThan(50)
	})
	test('never moves back as the finger goes further', () => {
		expect(rubberBand(-400, -144, 0)).toBeLessThan(rubberBand(-300, -144, 0))
	})
})

describe('settleReveal', () => {
	const width = 144
	test('a short slow drag from shut stays shut', () => {
		expect(settleReveal({ offset: -40, velocity: -0.05, width })).toBe(false)
	})
	test('a drag past half from shut opens', () => {
		expect(settleReveal({ offset: -80, velocity: 0, width })).toBe(true)
	})
	test('a short fast flick opens', () => {
		expect(settleReveal({ offset: -24, velocity: -0.6, width })).toBe(true)
	})
	test('from open, a drag back past half closes', () => {
		expect(settleReveal({ offset: -60, velocity: 0, width })).toBe(false)
	})
	test('from open, a flick back closes', () => {
		expect(settleReveal({ offset: -120, velocity: 0.6, width })).toBe(false)
	})
	test('a flick against a long drag wins', () => {
		expect(settleReveal({ offset: -130, velocity: 0.5, width })).toBe(false)
	})
	test('a drag the wrong way from shut stays shut', () => {
		expect(settleReveal({ offset: 30, velocity: 0.4, width })).toBe(false)
	})
})

describe('settleCommit', () => {
	const width = 360
	test('a short slow drag snaps back', () => {
		expect(settleCommit({ offset: 40, velocity: 0.05, width })).toBe(0)
	})
	test('a drag past the threshold commits that way', () => {
		expect(settleCommit({ offset: 120, velocity: 0, width })).toBe(1)
		expect(settleCommit({ offset: -120, velocity: 0, width })).toBe(-1)
	})
	test('a flick commits', () => {
		expect(settleCommit({ offset: -30, velocity: -0.6, width })).toBe(-1)
	})
	test('a flick against the drag cancels', () => {
		expect(settleCommit({ offset: 140, velocity: -0.6, width })).toBe(0)
	})
})

describe('releaseVelocity', () => {
	// A finger moving 1px/ms left, sampled every 10ms for 100ms.
	const steady = Array.from({ length: 11 }, (_, i) => ({
		x: -i * 10,
		t: i * 10,
	}))
	test('a steady drag reads its speed', () => {
		expect(releaseVelocity(steady, 100, -100)).toBeCloseTo(-1)
	})
	test('a finger held still before lifting reads as still', () => {
		expect(releaseVelocity(steady, 600, -100)).toBe(0)
	})
	test('two moves a moment apart at the end do not read as a flick', () => {
		const coalesced = [
			{ x: 0, t: 0 },
			{ x: -40, t: 400 },
			{ x: -44, t: 401 },
		]
		expect(Math.abs(releaseVelocity(coalesced, 401, -44))).toBeLessThan(0.3)
	})
	test('a short drag never flicks, however fast', () => {
		expect(
			releaseVelocity(
				[
					{ x: 0, t: 0 },
					{ x: -9, t: 10 },
				],
				10,
				-9,
			),
		).toBe(0)
	})
	test('no moves read as still', () => {
		expect(releaseVelocity([], 50, 0)).toBe(0)
	})
})

describe('sheetDragIntent', () => {
	const top = { atTop: true, canScroll: true }
	test('waits until the finger has moved past the slop', () => {
		expect(sheetDragIntent({ dx: 1, dy: 5, ...top })).toBe('wait')
	})
	test('a pull down with the content at its top drags the sheet', () => {
		expect(sheetDragIntent({ dx: 2, dy: 12, ...top })).toBe('sheet')
	})
	test('a pull down with the content scrolled scrolls it', () => {
		expect(
			sheetDragIntent({ dx: 2, dy: 12, atTop: false, canScroll: true }),
		).toBe('scroll')
	})
	test('a push up scrolls content that can scroll', () => {
		expect(sheetDragIntent({ dx: 0, dy: -12, ...top })).toBe('scroll')
	})
	test("a push up on content that can't scroll drags the sheet", () => {
		expect(
			sheetDragIntent({ dx: 0, dy: -12, atTop: true, canScroll: false }),
		).toBe('sheet')
	})
	test('a sideways move is not the sheet’s', () => {
		expect(sheetDragIntent({ dx: 14, dy: 4, ...top })).toBe('scroll')
	})
})

describe('settleDismiss', () => {
	const height = 300
	test('a short slow pull stays', () => {
		expect(settleDismiss({ offset: 60, velocity: 0.1, height })).toBe(false)
	})
	test('a pull past the threshold dismisses', () => {
		expect(settleDismiss({ offset: 150, velocity: 0.1, height })).toBe(true)
	})
	test('a short fast flick down dismisses', () => {
		expect(settleDismiss({ offset: 30, velocity: 0.8, height })).toBe(true)
	})
	test('a flick up after a long pull stays', () => {
		expect(settleDismiss({ offset: 200, velocity: -0.8, height })).toBe(false)
	})
	test('a sheet pushed up stays', () => {
		expect(settleDismiss({ offset: -10, velocity: -0.1, height })).toBe(false)
	})
})
