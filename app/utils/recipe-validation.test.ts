import { expect, test } from 'vitest'
import { positiveMinutes } from './recipe-validation.ts'

test('a fractional time rounds to the nearest minute', () => {
	expect(positiveMinutes(12.4)).toBe(12)
	expect(positiveMinutes(30.6)).toBe(31)
	expect(positiveMinutes(0.5)).toBe(1)
})

test('a time that rounds to zero or below is no time', () => {
	for (const value of [0, 0.4, -0.4, -5]) {
		expect(positiveMinutes(value)).toBeNull()
	}
})

test('NaN and infinity are no time', () => {
	for (const value of [Number.NaN, Infinity, -Infinity]) {
		expect(positiveMinutes(value)).toBeNull()
	}
})

test('a time past the largest safe integer is no time', () => {
	expect(positiveMinutes(1e20)).toBeNull()
	expect(positiveMinutes(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
})

test('a value that is not a number is no time', () => {
	for (const value of ['15', null, undefined, true, {}]) {
		expect(positiveMinutes(value)).toBeNull()
	}
})
