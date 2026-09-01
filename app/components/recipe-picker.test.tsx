/**
 * @vitest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test, vi } from 'vitest'
import { RecipePicker } from './recipe-picker.tsx'

test('Menu Recipe picker finds accented titles with unaccented text', async () => {
	const user = userEvent.setup()
	const onPick = vi.fn()
	const recipes = [
		{
			id: 'soup',
			title: 'Ciorbă',
			totalTime: 45,
			yieldAmount: null,
			yieldLabel: null,
			isFavorite: false,
			image: null,
		},
		{
			id: 'salad',
			title: 'Green Salad',
			totalTime: 10,
			yieldAmount: null,
			yieldLabel: null,
			isFavorite: false,
			image: null,
		},
	]
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => <RecipePicker recipes={recipes} onPick={onPick} />,
		},
	])
	render(<Stub />)

	await user.click(
		screen.getAllByRole('button', { name: 'Add recipe' }).at(-1)!,
	)
	const picker = screen.getByRole('dialog', { name: 'Add a recipe' })
	await user.type(
		within(picker).getByPlaceholderText('Search recipes...'),
		'ciorba',
	)
	expect(within(picker).queryByText('Green Salad')).not.toBeInTheDocument()
	await user.click(within(picker).getByRole('button', { name: /Ciorbă/ }))

	expect(onPick).toHaveBeenCalledWith(recipes[0])
})
