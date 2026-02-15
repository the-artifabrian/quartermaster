import { describe, expect, test } from 'vitest'
import { detectTemperatures } from './temperature-detection.ts'

describe('detectTemperatures', () => {
	test('basic Fahrenheit: "350°F"', () => {
		const matches = detectTemperatures('Preheat oven to 350°F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 350,
			valueHigh: null,
			unit: 'F',
			converted: '175°C',
		})
	})

	test('basic Celsius: "180°C"', () => {
		const matches = detectTemperatures('Preheat oven to 180°C')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 180,
			valueHigh: null,
			unit: 'C',
			converted: '355°F',
		})
	})

	test('space before unit: "350 °F"', () => {
		const matches = detectTemperatures('Preheat oven to 350 °F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({ value: 350, unit: 'F' })
	})

	test('"degrees" word form: "350 degrees F"', () => {
		const matches = detectTemperatures('Preheat oven to 350 degrees F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({ value: 350, unit: 'F' })
	})

	test('"degrees Fahrenheit"', () => {
		const matches = detectTemperatures('Set to 400 degrees Fahrenheit')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 400,
			unit: 'F',
			converted: '205°C',
		})
	})

	test('"degrees Celsius"', () => {
		const matches = detectTemperatures('Set to 200 degrees Celsius')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 200,
			unit: 'C',
			converted: '390°F',
		})
	})

	test('range: "350-375°F"', () => {
		const matches = detectTemperatures('Bake at 350-375°F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 350,
			valueHigh: 375,
			unit: 'F',
			converted: '175–190°C',
		})
	})

	test('range with en-dash: "350–375°F"', () => {
		const matches = detectTemperatures('Bake at 350–375°F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			value: 350,
			valueHigh: 375,
			unit: 'F',
		})
	})

	test('skips when both units present: "350°F (175°C)"', () => {
		const matches = detectTemperatures('Preheat to 350°F (175°C)')
		expect(matches).toHaveLength(0)
	})

	test('skips when both units present reversed: "(175°C) 350°F"', () => {
		const matches = detectTemperatures('Preheat to (175°C) 350°F')
		expect(matches).toHaveLength(0)
	})

	test('skips when both units present with "degrees" word form', () => {
		const matches = detectTemperatures(
			'Preheat to 350 degrees F (175 degrees C)',
		)
		expect(matches).toHaveLength(0)
	})

	test('multiple temperatures in one string', () => {
		const matches = detectTemperatures(
			'Start at 400°F for 10 min, then reduce to 350°F',
		)
		expect(matches).toHaveLength(2)
		expect(matches[0]).toMatchObject({ value: 400, converted: '205°C' })
		expect(matches[1]).toMatchObject({ value: 350, converted: '175°C' })
	})

	test('skips unreasonable Fahrenheit (too low)', () => {
		const matches = detectTemperatures('Mix 50°F water')
		expect(matches).toHaveLength(0)
	})

	test('skips unreasonable Celsius (too low)', () => {
		const matches = detectTemperatures('Use 10°C water')
		expect(matches).toHaveLength(0)
	})

	test('no matches in plain text', () => {
		const matches = detectTemperatures('Mix the flour and sugar together')
		expect(matches).toHaveLength(0)
	})

	test('common oven temps round nicely', () => {
		// 425°F = 218.33°C → rounds to 220°C
		const matches = detectTemperatures('Roast at 425°F')
		expect(matches[0]).toMatchObject({ converted: '220°C' })
	})

	test('preserves match positions', () => {
		const text = 'Preheat to 350°F and bake'
		const matches = detectTemperatures(text)
		expect(matches).toHaveLength(1)
		expect(text.slice(matches[0]!.startIndex, matches[0]!.endIndex)).toBe(
			'350°F',
		)
	})

	test('lowercase: "350°f"', () => {
		const matches = detectTemperatures('Preheat oven to 350°f')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({ value: 350, unit: 'F' })
	})

	test('range where both convert to same value collapses', () => {
		// 349°F = 176.1°C → 175, 351°F = 177.2°C → 175
		const matches = detectTemperatures('Bake at 349-351°F')
		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({ converted: '175°C' })
	})
})
