/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import {
	RecipeIngredientsControls,
	RecipeScaleControl,
} from './recipe-scale-control.tsx'

function renderIngredientsControls({
	scaleMultiplier = 1,
	yieldAmount = 12,
	yieldLabel = 'pieces',
	onScaleMultiplierChange = vi.fn(),
	useMetric = false,
}: {
	scaleMultiplier?: number
	yieldAmount?: number | null
	yieldLabel?: string | null
	onScaleMultiplierChange?: (value: number) => void
	useMetric?: boolean
} = {}) {
	return render(
		<RecipeIngredientsControls
			scaleMultiplier={scaleMultiplier}
			yieldAmount={yieldAmount}
			yieldLabel={yieldLabel}
			onScaleMultiplierChange={onScaleMultiplierChange}
			ingredientsExpanded
			onToggleIngredients={vi.fn()}
			useMetric={useMetric}
			onToggleMetric={vi.fn()}
		/>,
	)
}

test('Ingredients header keeps scale quiet while showing typed yield as context', () => {
	renderIngredientsControls({ scaleMultiplier: 1.5 })

	expect(screen.getByRole('button', { name: 'Scale 1.5×' })).toBeVisible()
	expect(screen.queryByRole('textbox', { name: 'Scale multiplier' })).toBeNull()
	expect(screen.getByText('Makes 18 pieces')).toBeVisible()
	expect(screen.getByText('original: 12')).toBeVisible()
})

test('scale trigger opens the bounded explicit editor', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	renderIngredientsControls({ onScaleMultiplierChange: onChange })

	await user.click(screen.getByRole('button', { name: 'Scale 1×' }))
	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	expect(input).toHaveValue('1')
	expect(input).toHaveAttribute('maxlength', '6')

	await user.clear(input)
	await user.type(input, '1.5')
	await user.keyboard('{Enter}')
	expect(onChange).toHaveBeenCalledWith(1.5)
})

test('scaled Recipe offers one clear return to the original batch', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	renderIngredientsControls({
		scaleMultiplier: 2,
		onScaleMultiplierChange: onChange,
	})

	await user.click(screen.getByRole('button', { name: 'Scale 2×' }))
	await user.click(screen.getByRole('button', { name: 'Original 1×' }))
	expect(onChange).toHaveBeenCalledWith(1)
})

test('original multiplier does not show a redundant reset', async () => {
	const user = userEvent.setup()
	renderIngredientsControls()

	await user.click(screen.getByRole('button', { name: 'Scale 1×' }))
	expect(screen.queryByRole('button', { name: 'Original 1×' })).toBeNull()
	expect(screen.queryByText(/original:/)).toBeNull()
})

test('unknown typed yield keeps only the multiplier vocabulary', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	renderIngredientsControls({
		scaleMultiplier: 1.5,
		yieldAmount: null,
		yieldLabel: null,
		onScaleMultiplierChange: onChange,
	})

	expect(screen.queryByText(/Makes/)).toBeNull()
	await user.click(screen.getByRole('button', { name: 'Scale 1.5×' }))
	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	await user.clear(input)
	await user.type(input, '0,75')
	await user.tab()
	expect(onChange).toHaveBeenCalledWith(0.75)
})

test('multiplier input is bounded while typing', async () => {
	const user = userEvent.setup()
	renderIngredientsControls({ yieldAmount: null, yieldLabel: null })

	await user.click(screen.getByRole('button', { name: 'Scale 1×' }))
	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	await user.clear(input)
	await user.type(input, '100000')
	expect(input).toHaveValue('100')
	await user.clear(input)
	await user.type(input, '1.2345')
	expect(input).toHaveValue('1.23')
})

test('invalid committed multiplier returns to the stored value', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	renderIngredientsControls({ onScaleMultiplierChange: onChange })

	await user.click(screen.getByRole('button', { name: 'Scale 1×' }))
	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	await user.clear(input)
	await user.type(input, '0')
	await user.keyboard('{Enter}')
	expect(input).toHaveValue('1')
	expect(input).not.toHaveAttribute('aria-invalid')
	expect(onChange).not.toHaveBeenCalled()
})

test('step buttons provide half-batch adjustments', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	renderIngredientsControls({ onScaleMultiplierChange: onChange })

	await user.click(screen.getByRole('button', { name: 'Scale 1×' }))
	await user.click(
		screen.getByRole('button', { name: 'Increase recipe scale' }),
	)
	expect(onChange).toHaveBeenCalledWith(1.5)
})

test('long typed yield wraps without repeating the label', () => {
	renderIngredientsControls({
		scaleMultiplier: 2,
		yieldAmount: 4,
		yieldLabel: 'individual poolish dough balls',
	})

	const output = screen.getByText('Makes 8 individual poolish dough balls')
	expect(output).not.toHaveClass('truncate')
	expect(screen.getByText('original: 4')).toBeVisible()
})

test('Ingredients disclosure and Metric remain direct header controls', () => {
	renderIngredientsControls({ useMetric: true })

	expect(screen.getByRole('button', { name: 'Ingredients' })).toHaveAttribute(
		'aria-expanded',
		'true',
	)
	expect(screen.getByRole('button', { name: 'Metric' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
})

test('compact Meal scaling retains comma-decimal entry', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
			compact
		/>,
	)

	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '1,5')
	await user.tab()
	expect(onChange).toHaveBeenCalledWith(1.5)
})
