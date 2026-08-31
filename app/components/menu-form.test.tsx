/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { MenuForm } from './menu-form.tsx'

test('Menu editing uses multipliers for every Recipe and keeps yield explanatory', async () => {
	const user = userEvent.setup()
	const recipes = [
		{
			id: 'known',
			title: 'Pepper parcels',
			totalTime: null,
			yieldAmount: 12,
			yieldLabel: 'pieces',
			isFavorite: false,
			image: null,
		},
		{
			id: 'unknown',
			title: 'Family stew',
			totalTime: null,
			yieldAmount: null,
			yieldLabel: null,
			isFavorite: false,
			image: null,
		},
	]
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<MenuForm
					menu={{ id: 'menu', title: 'Canonical Dinner' }}
					builder={{
						recipes,
						sections: [
							{
								id: 'section',
								name: null,
								items: [
									{
										id: 'known-item',
										kind: 'recipe',
										recipeId: 'known',
										recipeTitle: 'Pepper parcels',
										scaleMultiplier: 1.5,
										note: null,
									},
									{
										id: 'unknown-item',
										kind: 'recipe',
										recipeId: 'unknown',
										recipeTitle: 'Family stew',
										scaleMultiplier: 2.5,
										note: null,
									},
								],
							},
						],
					}}
				/>
			),
		},
	])
	render(<Stub />)

	const knownMultiplier = screen.getByRole('textbox', {
		name: 'Scale multiplier for Pepper parcels',
	})
	expect(knownMultiplier).toHaveValue('1.5')
	expect(screen.getByText('Makes 18 pieces')).toBeInTheDocument()
	expect(
		screen.getByRole('textbox', {
			name: 'Scale multiplier for Family stew',
		}),
	).toHaveValue('2.5')
	expect(screen.queryByLabelText(/Target pieces/)).not.toBeInTheDocument()
	expect(
		screen.queryByText(/servings/i, { selector: 'label, span' }),
	).not.toBeInTheDocument()

	await user.clear(knownMultiplier)
	await user.type(knownMultiplier, '2')
	await user.tab()
	expect(screen.getByText('Makes 24 pieces')).toBeInTheDocument()
})
