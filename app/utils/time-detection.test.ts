import { describe, expect, test } from 'vitest'
import { detectTimes } from './time-detection.ts'

describe('detectTimes', () => {
	test('basic: "Cook for 15 minutes"', () => {
		const matches = detectTimes('Cook for 15 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(900)
		expect(matches[0]!.label).toBe('15 min')
	})

	test('singular: "1 minute"', () => {
		const matches = detectTimes('Stir for 1 minute')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(60)
	})

	test('plural: "15 minutes"', () => {
		const matches = detectTimes('Simmer 15 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(900)
	})

	test('short form: "5 min"', () => {
		const matches = detectTimes('Cook 5 min')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(300)
	})

	test('short form: "10 mins"', () => {
		const matches = detectTimes('Bake 10 mins')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(600)
	})

	test('short form: "2 hrs"', () => {
		const matches = detectTimes('Slow cook 2 hrs')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(7200)
	})

	test('ranges: "20-30 minutes" → upper bound (1800s)', () => {
		const matches = detectTimes('Bake for 20-30 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(1800)
		expect(matches[0]!.label).toBe('30 min')
	})

	test('fractions: "1.5 hours" → 5400s', () => {
		const matches = detectTimes('Simmer for 1.5 hours')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(5400)
	})

	test('unicode fractions: "1½ hours" → 5400s', () => {
		const matches = detectTimes('Braise for 1½ hours')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(5400)
	})

	test('combined: "1 hour 30 minutes" → 5400s', () => {
		const matches = detectTimes('Cook for 1 hour 30 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(5400)
		expect(matches[0]!.label).toBe('1 hr 30 min')
	})

	test('combined with "and": "1 hour and 30 minutes"', () => {
		const matches = detectTimes('Bake for 1 hour and 30 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(5400)
	})

	test('seconds: "30 seconds" → 30s', () => {
		const matches = detectTimes('Microwave for 30 seconds')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(30)
		expect(matches[0]!.label).toBe('30 sec')
	})

	test('prefix: "about 15 minutes"', () => {
		const matches = detectTimes('Cook about 15 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(900)
	})

	test('prefix: "approximately 20 minutes"', () => {
		const matches = detectTimes('Bake approximately 20 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(1200)
	})

	test('prefix: "another 5 minutes"', () => {
		const matches = detectTimes('Cook another 5 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(300)
	})

	test('prefix: "an additional 10 minutes"', () => {
		const matches = detectTimes('Bake an additional 10 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(600)
	})

	test('multiple: "sauté 5 minutes then bake 25 minutes"', () => {
		const matches = detectTimes('Sauté 5 minutes then bake 25 minutes')
		expect(matches).toHaveLength(2)
		expect(matches[0]!.durationSeconds).toBe(300)
		expect(matches[1]!.durationSeconds).toBe(1500)
	})

	test('temperature false positive: "Preheat to 350°F for 10 minutes" → only 10 min', () => {
		const matches = detectTimes('Preheat to 350°F for 10 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(600)
		expect(matches[0]!.label).toBe('10 min')
	})

	test('no match: "Add 3 eggs" → []', () => {
		const matches = detectTimes('Add 3 eggs')
		expect(matches).toHaveLength(0)
	})

	test('"an hour" → 3600s', () => {
		const matches = detectTimes('Let rise for an hour')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(3600)
		expect(matches[0]!.label).toBe('1 hr')
	})

	test('no match: "a few minutes" → [] (too vague)', () => {
		const matches = detectTimes('Wait a few minutes')
		expect(matches).toHaveLength(0)
	})

	test('matches include correct start/end indices', () => {
		const text = 'Cook for 15 minutes until done'
		const matches = detectTimes(text)
		expect(matches).toHaveLength(1)
		const matched = text.slice(matches[0]!.startIndex, matches[0]!.endIndex)
		expect(matched).toContain('15 minutes')
	})

	test('em dash range: "20–30 minutes"', () => {
		const matches = detectTimes('Bake for 20–30 minutes')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(1800)
	})

	test('1 hour (not combined)', () => {
		const matches = detectTimes('Simmer for 1 hour')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(3600)
		expect(matches[0]!.label).toBe('1 hr')
	})

	test('2 hours', () => {
		const matches = detectTimes('Braise for 2 hours')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.durationSeconds).toBe(7200)
		expect(matches[0]!.label).toBe('2 hrs')
	})
})
