import { describe, expect, test } from 'vitest'
import { lockAxis, rubberBand, settleReveal, settleCommit } from './swipe.ts'

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
// commit settle (Plan week) — a short slow drag snaps back; past the
//   distance threshold commits that way; a flick commits; a flick against
//   the drag cancels.

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
