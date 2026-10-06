import { expect, test } from 'vitest'
import { formatDuration } from './format-duration.ts'

// Failure list: each entry is an input that could render wrong.

test('zero minutes reads as 0 min', () => {
	expect(formatDuration(0)).toBe('0 min')
})

test('a negative duration reads as 0 min instead of a minus sign', () => {
	expect(formatDuration(-30)).toBe('0 min')
})

test('NaN reads as 0 min instead of "NaN min"', () => {
	expect(formatDuration(Number.NaN)).toBe('0 min')
})

test('Infinity reads as 0 min instead of "Infinity days"', () => {
	expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0 min')
})

test('fractional minutes round to whole minutes', () => {
	expect(formatDuration(44.6)).toBe('45 min')
})

test('a fraction that rounds up to the hour reads as hours, not 60 min', () => {
	expect(formatDuration(59.6)).toBe('1 hr')
})

test('one minute keeps "min"', () => {
	expect(formatDuration(1)).toBe('1 min')
})

test('just under an hour stays in minutes', () => {
	expect(formatDuration(59)).toBe('59 min')
})

test('exactly an hour drops the zero minutes', () => {
	expect(formatDuration(60)).toBe('1 hr')
})

test('hours and minutes show both', () => {
	expect(formatDuration(90)).toBe('1 hr 30 min')
})

test('many whole hours stay in hours below a day', () => {
	expect(formatDuration(1140)).toBe('19 hr')
})

test('just under a day keeps hours and minutes', () => {
	expect(formatDuration(1439)).toBe('23 hr 59 min')
})

test('exactly a day reads as 1 day', () => {
	expect(formatDuration(1440)).toBe('1 day')
})

test('a day and hours shows both', () => {
	expect(formatDuration(1560)).toBe('1 day 2 hr')
})

test('minutes drop once the duration reaches a day', () => {
	expect(formatDuration(1470)).toBe('1 day')
})

test('leftover minutes past a day never round up into an extra hour', () => {
	expect(formatDuration(1499)).toBe('1 day')
})

test('several days pluralise "days" and drop zero hours', () => {
	expect(formatDuration(2880)).toBe('2 days')
})

test('several days and hours show both', () => {
	expect(formatDuration(3600)).toBe('2 days 12 hr')
})
