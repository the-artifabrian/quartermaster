/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { RecipeForm } from './recipe-form.tsx'

test('Recipe form offers optional time and natural makes fields', () => {
	const Stub = createRoutesStub([
		{ path: '/', Component: () => <RecipeForm submitLabel="Create Recipe" /> },
	])
	render(<Stub />)
	fireEvent.click(screen.getByText('Details', { exact: true }))

	expect(
		screen.getByRole('spinbutton', { name: 'Active Time (min)' }),
	).toBeVisible()
	expect(
		screen.getByRole('spinbutton', { name: 'Total Time (min)' }),
	).toBeVisible()
	expect(screen.getByText('This recipe makes')).toBeVisible()
	expect(
		screen.getByRole('spinbutton', { name: 'Amount this recipe makes' }),
	).toBeVisible()
	expect(
		screen.getByRole('combobox', { name: 'What this recipe makes' }),
	).toHaveAttribute('list', 'yield-label-suggestions')
	expect(screen.getByText(/Leave both blank if unknown/i)).toBeVisible()
	expect(
		screen.queryByRole('spinbutton', { name: 'Prep Time (min)' }),
	).not.toBeInTheDocument()
	expect(
		screen.queryByRole('spinbutton', { name: 'Cook Time (min)' }),
	).not.toBeInTheDocument()
	expect(
		screen.queryByRole('spinbutton', { name: 'Servings' }),
	).not.toBeInTheDocument()
})

test('Recipe form reopens explicit time and typed yield values for editing', () => {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<RecipeForm
					recipe={{
						id: 'recipe-1',
						title: 'Braided loaf',
						activeTime: 25,
						totalTime: 180,
						yieldAmount: 2.5,
						yieldLabel: 'large braided loaves',
						ingredients: [{ id: 'ingredient-1', name: 'flour' }],
						instructions: [{ id: 'instruction-1', content: 'Knead.' }],
					}}
				/>
			),
		},
	])
	render(<Stub />)
	fireEvent.click(screen.getByText('Details', { exact: true }))

	expect(
		screen.getByRole('spinbutton', { name: 'Active Time (min)' }),
	).toHaveValue(25)
	expect(
		screen.getByRole('spinbutton', { name: 'Total Time (min)' }),
	).toHaveValue(180)
	expect(
		screen.getByRole('spinbutton', { name: 'Amount this recipe makes' }),
	).toHaveValue(2.5)
	expect(
		screen.getByRole('combobox', { name: 'What this recipe makes' }),
	).toHaveValue('large braided loaves')
})

test('invalid optional details reopen and focus the field before saving', async () => {
	const user = userEvent.setup()
	const save = vi.fn(() => null)
	const Stub = createRoutesStub([
		{ path: '/', action: save, Component: () => <RecipeForm /> },
	])
	render(<Stub />)
	await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Pasta')
	await user.type(screen.getByPlaceholderText('Ingredient name'), 'pasta')
	await user.type(screen.getByPlaceholderText('Step 1'), 'Boil.')
	const details = screen.getByText('Details', { exact: true })
	await user.click(details)
	const source = screen.getByRole('textbox', { name: 'Source URL' })
	await user.type(source, 'not a URL')
	await user.click(details)
	expect(source).not.toBeVisible()
	await user.click(screen.getByRole('button', { name: 'Save Recipe' }))
	await waitFor(() => expect(source).toBeVisible())
	expect(source).toHaveFocus()
	expect(source).toHaveAttribute('aria-invalid', 'true')
	expect(save).not.toHaveBeenCalled()
	await user.clear(source)
	await user.type(source, 'https://example.test/pasta')
	await user.click(details)
	await user.click(screen.getByRole('button', { name: 'Save Recipe' }))
	await waitFor(() => expect(save).toHaveBeenCalledOnce())
})
