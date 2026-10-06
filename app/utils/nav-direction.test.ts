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
	expect(getNavDirection({ type: 'POP', from: OPEN_DETAIL, to: null })).toBe(
		'back',
	)
})

test('going forward again onto a detail page slides it in', () => {
	expect(getNavDirection({ type: 'POP', from: null, to: OPEN_DETAIL })).toBe(
		'forward',
	)
})

test('going back from a page reached by a back link slides the detail in', () => {
	expect(
		getNavDirection({ type: 'POP', from: BACK_TO_LIST, to: OPEN_DETAIL }),
	).toBe('forward')
})

test('going back between tabs keeps the cross-fade', () => {
	expect(getNavDirection({ type: 'POP', from: null, to: null })).toBeNull()
})

test('a back swipe the system already animated gets no second animation', () => {
	expect(
		getNavDirection({
			type: 'POP',
			from: OPEN_DETAIL,
			to: null,
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
