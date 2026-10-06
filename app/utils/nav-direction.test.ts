import { expect, test } from 'vitest'
import { BACK_TO_LIST, getNavDirection, OPEN_DETAIL } from './nav-direction.ts'

test('a tab switch, which carries no marker, keeps the cross-fade', () => {
	expect(getNavDirection({ type: 'PUSH', from: null, to: null })).toBeNull()
})

test('opening a detail page slides it in', () => {
	expect(getNavDirection({ type: 'PUSH', from: null, to: OPEN_DETAIL })).toBe(
		'forward',
	)
})

test('an in-page back link slides the page out', () => {
	expect(
		getNavDirection({ type: 'PUSH', from: OPEN_DETAIL, to: BACK_TO_LIST }),
	).toBe('back')
})

test('going back from a detail page slides it out', () => {
	expect(
		getNavDirection({
			type: 'POP',
			from: OPEN_DETAIL,
			to: null,
			historyMove: 'back',
		}),
	).toBe('back')
})

test('back from an unmarked child onto a detail page keeps the cross-fade', () => {
	// Recipes → Recipe (marked) → Edit → Cancel, which is history.back().
	expect(
		getNavDirection({
			type: 'POP',
			from: null,
			to: OPEN_DETAIL,
			historyMove: 'back',
		}),
	).toBeNull()
})

test('back from a page reached by a back link never slides forward', () => {
	expect(
		getNavDirection({
			type: 'POP',
			from: BACK_TO_LIST,
			to: OPEN_DETAIL,
			historyMove: 'back',
		}),
	).toBeNull()
})

test('going forward through history onto a detail page slides it in', () => {
	expect(
		getNavDirection({
			type: 'POP',
			from: null,
			to: OPEN_DETAIL,
			historyMove: 'forward',
		}),
	).toBe('forward')
})

test('a pop whose direction is unknown never slides forward', () => {
	expect(
		getNavDirection({ type: 'POP', from: null, to: OPEN_DETAIL }),
	).toBeNull()
	expect(getNavDirection({ type: 'POP', from: OPEN_DETAIL, to: null })).toBe(
		'back',
	)
})

test('going back between tabs keeps the cross-fade', () => {
	expect(
		getNavDirection({ type: 'POP', from: null, to: null, historyMove: 'back' }),
	).toBeNull()
})

test('a back swipe the system already animated gets no second animation', () => {
	expect(
		getNavDirection({
			type: 'POP',
			from: OPEN_DETAIL,
			to: null,
			historyMove: 'back',
			hasUAVisualTransition: true,
		}),
	).toBe('none')
})

test('location state set by other code is not mistaken for a direction', () => {
	for (const state of [
		'forward',
		{ navDirection: 'sideways' },
		{ from: '/x' },
		0,
	])
		expect(getNavDirection({ type: 'PUSH', from: null, to: state })).toBeNull()
})
