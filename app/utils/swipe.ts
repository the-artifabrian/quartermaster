/**
 * The arithmetic behind the app's horizontal swipes (Shopping rows, the Plan
 * week). While the finger is down the element follows it 1:1; when it lifts,
 * these decide where it settles: by distance, unless the release was a flick,
 * in which case the flick's direction wins.
 */

/** Movement (px) before a gesture picks an axis. */
const SLOP = 8
/** A release faster than this (px/ms) is a flick. */
const FLICK_VELOCITY = 0.3
/** How much of the travel past an end still shows. */
const ELASTICITY = 0.2

/**
 * Which axis the gesture belongs to, or null while it is too small to tell.
 * A tie goes to vertical scrolling, so a slanted scroll never swipes.
 */
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
	if (Math.hypot(dx, dy) < SLOP) return null
	return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/** Follows the finger between min and max; past either end, resists. */
export function rubberBand(value: number, min: number, max: number) {
	if (value < min) return min - (min - value) * ELASTICITY
	if (value > max) return max + (value - max) * ELASTICITY
	return value
}

type Release = {
	/** Where the element is (px), negative to the left. */
	offset: number
	/** Release velocity (px/ms), negative to the left. */
	velocity: number
	/** Full travel (px). */
	width: number
}

/** Whether a row revealing actions to its right should settle open. */
export function settleReveal({ offset, velocity, width }: Release) {
	if (Math.abs(velocity) > FLICK_VELOCITY) return velocity < 0
	return offset < -width / 2
}

/**
 * Whether a page-like swipe commits: 1 to the right, -1 to the left, 0 to snap
 * back. A quarter of the width is enough to commit.
 */
export function settleCommit({ offset, velocity, width }: Release): -1 | 0 | 1 {
	if (Math.abs(velocity) > FLICK_VELOCITY) {
		// A flick against the drag cancels it.
		if (Math.sign(velocity) !== Math.sign(offset) && offset !== 0) return 0
		return velocity < 0 ? -1 : 1
	}
	if (Math.abs(offset) < width / 4) return 0
	return offset < 0 ? -1 : 1
}
