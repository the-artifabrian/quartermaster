/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { RecipeScaleControl } from './recipe-scale-control.tsx'

test('known Recipe yield edits a target amount and commits its multiplier', async () => {
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

	const input = screen.getByRole('textbox', { name: 'Target pieces' })
	expect(input).toHaveValue('18')
	expect(screen.getByText('pieces')).toBeInTheDocument()
	expect(screen.queryByText('servings')).not.toBeInTheDocument()

	await user.clear(input)
	await user.type(input, '24')
	await user.tab()
	expect(onChange).toHaveBeenCalledWith(2)
})

test('known Recipe yield reveals its multiplier only after scaling', () => {
	const onChange = vi.fn()
	const { rerender } = render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	const input = screen.getByRole('textbox', { name: 'Target bowls' })
	expect(screen.queryByText(/· 1×/)).not.toBeInTheDocument()
	expect(input).not.toHaveAccessibleDescription()

	rerender(
		<RecipeScaleControl
			scaleMultiplier={1.5}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={onChange}
		/>,
	)

	expect(screen.getByText('· 1.5×')).toBeInTheDocument()
	expect(input).toHaveAccessibleDescription('1.5 times recipe')
})

test('known Recipe yield visibly identifies the amount as a target', () => {
	render(
		<RecipeScaleControl
			scaleMultiplier={1}
			yieldAmount={4}
			yieldLabel="bowls"
			onScaleMultiplierChange={vi.fn()}
		/>,
	)

	expect(screen.getByText('Target')).toBeInTheDocument()
})

test('unknown typed yield ignores legacy servings and edits the multiplier', async () => {
	const user = userEvent.setup()
	const onChange = vi.fn()
	render(
		<RecipeScaleControl
			scaleMultiplier={1.5}
			yieldAmount={null}
			yieldLabel={null}
			servings={12}
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

test('known yield accepts comma-decimal target input', async () => {
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

	const input = screen.getByLabelText('Target cakes')
	await user.clear(input)
	await user.type(input, '3,5')
	await user.tab()

	expect(onChange).toHaveBeenCalledWith(1.75)
})

test('invalid target stays editable without replacing the stored multiplier', async () => {
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

	const input = screen.getByRole('textbox', { name: 'Target bowls' })
	await user.clear(input)
	await user.type(input, '0')
	await user.keyboard('{Enter}')

	expect(input).toHaveAttribute('aria-invalid', 'true')
	expect(onChange).not.toHaveBeenCalled()
})
