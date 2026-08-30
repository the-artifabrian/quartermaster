/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { RecipeScaleControl } from './recipe-scale-control.tsx'

test('known Recipe yield keeps multiplier primary and shows derived output', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1.5}
			yieldAmount={12}
			yieldLabel="pieces"
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	expect(input).toHaveValue('1.5')
	expect(screen.getByText('Makes 18 pieces')).toBeInTheDocument()
	expect(screen.getByText('originally 12 pieces')).toBeInTheDocument()

	await user.clear(input)
	await user.type(input, '2')
	await user.tab()
	expect(onChange).toHaveBeenCalledWith(2)
})

test('known Recipe yield stays secondary at the original multiplier', () => {
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	expect(screen.getByLabelText('Scale multiplier')).toHaveValue('1')
	expect(screen.getByText('Makes 4 bowls')).toBeInTheDocument()
	expect(
		screen.queryByRole('button', { name: 'Back to 1×' }),
	).not.toBeInTheDocument()
})

test('scaled Recipe can return to the original multiplier', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={2}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	await user.click(screen.getByRole('button', { name: 'Back to 1×' }))
	expect(onChange).toHaveBeenCalledWith(1)
})

test('step buttons provide cooking-friendly half-batch adjustments', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	const { rerender } = render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	await user.click(
		screen.getByRole('button', { name: 'Increase recipe scale' }),
	)
	expect(onChange).toHaveBeenCalledWith(1.5)
	rerender(
		<RecipeScaleControl
			scaleMultiplier={1.5}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)
	await user.click(
		screen.getByRole('button', { name: 'Decrease recipe scale' }),
	)
	expect(onChange).toHaveBeenCalledWith(1)
})

test('unknown typed yield edits the multiplier', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1.5}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	expect(input).toHaveValue('1.5')
	expect(screen.getByText('×')).toBeInTheDocument()
	expect(screen.queryByText('servings')).not.toBeInTheDocument()

	await user.clear(input)
	await user.type(input, '0.75')
	await user.keyboard('{Enter}')
	expect(onChange).toHaveBeenCalledWith(0.75)
})

test('unknown yield preserves comma-decimal multiplier input', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={null}
			yieldLabel={null}
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '1,5')
	await user.tab()

	expect(onChange).toHaveBeenCalledWith(1.5)
})

test('known yield accepts comma-decimal multiplier input', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={2}
			yieldLabel="cakes"
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByLabelText('Scale multiplier')
	await user.clear(input)
	await user.type(input, '3,5')
	await user.tab()

	expect(onChange).toHaveBeenCalledWith(3.5)
})

test('invalid multiplier stays editable without replacing the stored multiplier', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByRole('textbox', { name: 'Scale multiplier' })
	await user.clear(input)
	await user.type(input, '0')
	await user.keyboard('{Enter}')

	expect(input).toHaveAttribute('aria-invalid', 'true')
	expect(onChange).not.toHaveBeenCalled()
})

test('long yield labels wrap instead of being truncated', () => {
	render(
		<RecipeScaleControl
			scaleMultiplier={2}
			yieldAmount={4}
			yieldLabel="individual poolish dough balls"
			onScaleMultiplierChange={vi.fn()}
		/>,
	)

	const output = screen.getByText('Makes 8 individual poolish dough balls')
	expect(output).not.toHaveClass('truncate')
})
