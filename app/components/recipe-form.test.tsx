/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { RecipeForm } from './recipe-form.tsx'

test('Recipe form offers optional time and natural makes fields', () => {
	const Stub = createRoutesStub([
		{ path: '/', Component: () => <RecipeForm submitLabel="Create Recipe" /> },
	])
	render(<Stub />)

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
