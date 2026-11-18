/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
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

test('a scaled typed yield names its label once, beside the original', () => {
	renderIngredientsControls({
		scaleMultiplier: 2,
		yieldAmount: 4,
		yieldLabel: 'individual poolish dough balls',
	})

	expect(
		screen.getByText('Makes 8 individual poolish dough balls'),
	).toBeVisible()
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

// Scale's sheet saves the typed multiplier through `commitRef` when it closes;
// the field can blur right after, before the parent has taken the value.
test('a save through commitRef followed by a blur saves once', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	const commitRef: { current: (() => void) | null } = { current: null }
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
			commitRef={commitRef}
		/>,
	)
	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '2')
	act(() => commitRef.current!())
	await user.tab()
	expect(onChange).toHaveBeenCalledTimes(1)
	expect(onChange).toHaveBeenCalledWith(2)
})

test('two saves of the same typed multiplier through commitRef send it once', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	const commitRef: { current: (() => void) | null } = { current: null }
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
			commitRef={commitRef}
		/>,
	)
	await user.clear(screen.getByLabelText('Scale multiplier'))
	await user.type(screen.getByLabelText('Scale multiplier'), '2')
	act(() => commitRef.current!())
	act(() => commitRef.current!())
	expect(onChange).toHaveBeenCalledTimes(1)
})

test('after the parent takes a multiplier, a newly typed one still saves', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	const commitRef: { current: (() => void) | null } = { current: null }
	const props = {
		yieldAmount: null,
		yieldLabel: null,
		onScaleMultiplierChange: onChange,
		commitRef,
	}
	const { rerender } = render(
		<RecipeScaleControl scaleMultiplier={1} {...props} />,
	)
	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '2')
	act(() => commitRef.current!())
	rerender(<RecipeScaleControl scaleMultiplier={2} {...props} />)
	await user.clear(input)
	await user.type(input, '3')
	act(() => commitRef.current!())
	expect(onChange.mock.calls).toEqual([[2], [3]])
})

test('typing the sent multiplier again after editing it saves it again', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	const commitRef: { current: (() => void) | null } = { current: null }
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
			commitRef={commitRef}
		/>,
	)
	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '2')
	act(() => commitRef.current!())
	await user.clear(input)
	await user.type(input, '2')
	act(() => commitRef.current!())
	expect(onChange.mock.calls).toEqual([[2], [2]])
})
