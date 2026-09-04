/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
	InstructionWithCookingCues,
	selectNonOverlappingCookingCues,
	type CookingCueMatch,
} from './instruction-with-cooking-cues.tsx'

function visibleInstructionText(container: HTMLElement) {
	const copy = container.cloneNode(true) as HTMLElement
	copy
		.querySelectorAll('[role="tooltip"]')
		.forEach((tooltip) => tooltip.remove())
	return copy.textContent
}

describe('InstructionWithCookingCues', () => {
	test('leaves unrecognized instruction text ordinary and unchanged', () => {
		const content = 'Stir until glossy and serve right away.'
		const { container } = render(
			<InstructionWithCookingCues content={content} />,
		)

		expect(container).toHaveTextContent(content)
		expect(container.querySelector('[data-cooking-cue]')).toBeNull()
	})

	test('renders multiple passive durations once while preserving punctuation and order', () => {
		const content =
			'Bake at 400°F for 10 minutes, then lower to 350°F and rest 5 min.'
		const { container } = render(
			<InstructionWithCookingCues content={content} />,
		)

		const durations = container.querySelectorAll(
			'[data-cooking-cue="duration"]',
		)
		expect([...durations].map((cue) => cue.textContent)).toEqual([
			'for 10 minutes',
			'5 min',
		])
		expect(
			screen.queryByRole('button', { name: /10 minutes|5 min/i }),
		).not.toBeInTheDocument()
		expect(
			container.querySelectorAll('[data-cooking-cue="temperature"]'),
		).toHaveLength(2)
		expect(visibleInstructionText(container)).toBe(content)
	})

	test('keeps temperature conversion accessible by pointer, touch, and keyboard', () => {
		const { container } = render(
			<InstructionWithCookingCues content="Roast at 400°F." />,
		)
		const cue = screen.getByRole('button', {
			name: '400°F, converts to 205°C',
		})
		const tooltip = screen.getByRole('tooltip', { hidden: true })

		expect(cue).toHaveAttribute('tabindex', '0')
		expect(cue).toHaveClass('font-semibold', 'underline', 'text-copper-text')
		expect(tooltip).toHaveAttribute('aria-hidden', 'true')

		fireEvent.pointerEnter(cue, { pointerType: 'mouse' })
		expect(tooltip).toHaveAttribute('aria-hidden', 'false')
		fireEvent.click(cue)
		expect(tooltip).toHaveAttribute('aria-hidden', 'false')
		fireEvent.pointerLeave(cue, { pointerType: 'mouse' })
		expect(tooltip).toHaveAttribute('aria-hidden', 'true')

		fireEvent.click(cue)
		expect(tooltip).toHaveAttribute('aria-hidden', 'false')
		fireEvent.click(cue)
		expect(tooltip).toHaveAttribute('aria-hidden', 'true')

		fireEvent.keyDown(cue, { key: 'Escape' })
		expect(tooltip).toHaveAttribute('aria-hidden', 'true')

		expect(fireEvent.keyDown(cue, { key: ' ' })).toBe(false)
		expect(tooltip).toHaveAttribute('aria-hidden', 'false')
		expect(visibleInstructionText(container)).toBe('Roast at 400°F.')
	})
})

describe('selectNonOverlappingCookingCues', () => {
	test('uses a stable earliest, longest, temperature-first overlap policy', () => {
		const cues: CookingCueMatch[] = [
			{
				type: 'duration',
				match: {
					durationSeconds: 60,
					label: '1 min',
					startIndex: 4,
					endIndex: 10,
				},
			},
			{
				type: 'temperature',
				match: {
					originalText: 'overlap',
					value: 350,
					valueHigh: null,
					unit: 'F',
					converted: '175°C',
					startIndex: 4,
					endIndex: 10,
				},
			},
			{
				type: 'duration',
				match: {
					durationSeconds: 120,
					label: '2 min',
					startIndex: 4,
					endIndex: 14,
				},
			},
			{
				type: 'temperature',
				match: {
					originalText: 'later overlap',
					value: 400,
					valueHigh: null,
					unit: 'F',
					converted: '205°C',
					startIndex: 12,
					endIndex: 18,
				},
			},
			{
				type: 'duration',
				match: {
					durationSeconds: 300,
					label: '5 min',
					startIndex: 20,
					endIndex: 25,
				},
			},
		]

		expect(selectNonOverlappingCookingCues(cues)).toEqual([cues[2], cues[4]])
	})
})
