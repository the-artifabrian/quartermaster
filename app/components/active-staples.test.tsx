/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub, useLoaderData } from 'react-router'
import { expect, test } from 'vitest'
import { ActiveStaples } from './active-staples.tsx'

const largeStapleList = [
	{ id: 'rice', displayName: 'Brown rice', onShoppingList: false },
	// Already waiting in Next shop, so its row says so without being tapped.
	{ id: 'salt', displayName: 'Salt', onShoppingList: true },
	{ id: 'apples', displayName: 'Apples', onShoppingList: false },
	{ id: 'beans', displayName: 'Beans', onShoppingList: false },
	{ id: 'coffee', displayName: 'Coffee', onShoppingList: false },
	{ id: 'eggs', displayName: 'Eggs', onShoppingList: false },
	{ id: 'flour', displayName: 'Flour', onShoppingList: false },
	{ id: 'garlic', displayName: 'Garlic', onShoppingList: false },
	{ id: 'milk', displayName: 'Milk', onShoppingList: false },
	{ id: 'oats', displayName: 'Oats', onShoppingList: false },
	{ id: 'oil', displayName: 'Olive oil', onShoppingList: false },
	{ id: 'pasta', displayName: 'Pasta', onShoppingList: false },
	{ id: 'pepper', displayName: 'Pepper', onShoppingList: false },
	{ id: 'tea', displayName: 'Tea', onShoppingList: false },
]

function renderStaples() {
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => <ActiveStaples staples={largeStapleList} />,
			action: async () => ({ status: 'success' }),
		},
	])
	render(<Stub initialEntries={['/']} />)
}

test('the list is one alphabetical set of usual items, searchable', async () => {
	renderStaples()
	const user = userEvent.setup()

	const list = screen.getByRole('list', { name: 'Staples' })
	expect(within(list).getAllByRole('listitem')).toHaveLength(14)
	expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Apples')
	// Each row carries its own action and its own state; nothing states an
	// availability, and nothing asks the reader to look at the top of the page.
	expect(
		within(list).getByRole('button', { name: 'Add Apples to Next shop' }),
	).toBeVisible()
	expect(
		within(list).getByRole('button', { name: 'Salt is in Next shop' }),
	).toHaveTextContent('On list')
	expect(list).not.toHaveTextContent('Out')
	expect(list).not.toHaveTextContent('Available')
	// The live region is for a screen reader, not a banner to scroll back to.
	expect(screen.getByRole('status')).toHaveClass('sr-only')

	const search = screen.getByRole('searchbox', { name: 'Search Staples' })
	const addButton = screen.getByRole('button', { name: 'Add Staple' })
	expect(search).toBeVisible()
	expect(screen.queryByRole('textbox', { name: 'Add a Staple' })).toBeNull()
	await user.click(addButton)
	const addInput = screen.getByRole('textbox', { name: 'Add a Staple' })
	expect(addInput).toBeVisible()
	expect(addInput).toHaveAttribute('placeholder', 'Staple name')
	expect(screen.queryByRole('searchbox', { name: 'Search Staples' })).toBeNull()
	await user.keyboard('{Escape}')
	await waitFor(() =>
		expect(screen.getByRole('button', { name: 'Add Staple' })).toHaveFocus(),
	)

	const restoredSearch = screen.getByRole('searchbox', {
		name: 'Search Staples',
	})
	await user.type(restoredSearch, 'rice')
	expect(
		within(screen.getByRole('list', { name: 'Staples' })).getAllByRole(
			'listitem',
		),
	).toHaveLength(1)
	expect(screen.getByText('Brown rice')).toBeVisible()
	expect(screen.queryByText('Apples')).toBeNull()

	await user.clear(restoredSearch)
	await user.type(restoredSearch, 'something missing')
	expect(
		screen.getByRole('heading', { name: 'No Staples found' }),
	).toBeVisible()
	await user.click(screen.getByRole('button', { name: 'Clear search' }))
	expect(screen.getByText('Brown rice')).toBeVisible()

	// The archived Pantry and its restore action are gone (#289).
	expect(screen.queryByText('Advanced')).toBeNull()
	expect(screen.queryByText(/Pantry/)).toBeNull()
})

test('adding says so on the row itself, holds focus, and keeps the row in place', async () => {
	let staples = largeStapleList
	let finishAction: (() => void) | undefined
	const actionCanFinish = new Promise<void>((resolve) => {
		finishAction = resolve
	})
	function TestRoute() {
		const loaderData = useLoaderData() as { staples: typeof largeStapleList }
		return <ActiveStaples staples={loaderData.staples} />
	}
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: TestRoute,
			HydrateFallback: () => null,
			loader: () => ({ staples }),
			action: async ({ request }) => {
				const formData = await request.formData()
				await actionCanFinish
				staples = staples.map((staple) =>
					staple.id === formData.get('itemId')
						? { ...staple, onShoppingList: true }
						: staple,
				)
				return {
					status: 'success',
					action: 'add-staple-to-shop',
					message: 'Apples was added to Next shop.',
				}
			},
		},
	])
	render(<Stub initialEntries={['/']} />)
	const user = userEvent.setup()

	const appleButton = await screen.findByRole('button', {
		name: 'Add Apples to Next shop',
	})
	await user.click(appleButton)
	await waitFor(() => expect(appleButton).toHaveAttribute('aria-busy', 'true'))
	// In flight the row already reads as done, so a second tap is not invited.
	expect(appleButton).toHaveTextContent('On list')
	// The row does not move or disappear — this list is not a queue.
	expect(
		within(screen.getByRole('list', { name: 'Staples' })).getAllByRole(
			'listitem',
		)[0],
	).toHaveTextContent('Apples')

	finishAction?.()
	await waitFor(() => expect(appleButton).not.toHaveAttribute('aria-busy'))
	// The loader has revalidated, so the row keeps saying it without the
	// in-flight guess holding it there.
	expect(
		screen.getByRole('button', { name: 'Apples is in Next shop' }),
	).toHaveTextContent('On list')
	// The live region is fed from the row, so it settles a tick after the
	// fetcher does.
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent(
			'Apples was added to Next shop.',
		),
	)
	expect(appleButton).toHaveFocus()
})

test('add and remove keep their controls visible through pending and failure states', async () => {
	let finishAdd: (() => void) | undefined
	let finishRemove: (() => void) | undefined
	const addCanFinish = new Promise<void>((resolve) => {
		finishAdd = resolve
	})
	const removeCanFinish = new Promise<void>((resolve) => {
		finishRemove = resolve
	})
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ActiveStaples
					staples={[{ id: 'salt', displayName: 'Salt', onShoppingList: false }]}
				/>
			),
			action: async ({ request }) => {
				const formData = await request.formData()
				if (formData.get('intent') === 'add-staple') {
					await addCanFinish
					return {
						status: 'error',
						action: 'add-staple',
						message: 'Could not add Garlic. Try again.',
					}
				}
				await removeCanFinish
				return {
					status: 'error',
					action: 'remove-staple',
					message: 'Could not remove Salt. Try again.',
				}
			},
		},
	])
	render(<Stub initialEntries={['/']} />)
	const user = userEvent.setup()

	expect(screen.queryByRole('searchbox', { name: 'Search Staples' })).toBeNull()
	const addButton = screen.getByRole('button', { name: 'Add Staple' })
	expect(addButton).toHaveClass('min-h-11')
	await user.click(addButton)
	await user.type(
		screen.getByRole('textbox', { name: 'Add a Staple' }),
		'Garlic',
	)
	await user.click(screen.getByRole('button', { name: 'Add' }))
	expect(await screen.findByRole('button', { name: 'Adding…' })).toBeDisabled()
	finishAdd?.()
	expect(await screen.findByRole('alert', { name: '' })).toHaveTextContent(
		'Could not add Garlic. Try again.',
	)
	await user.click(screen.getByRole('button', { name: 'Cancel' }))
	await user.click(screen.getByRole('button', { name: 'Add Staple' }))
	expect(screen.queryByText('Could not add Garlic. Try again.')).toBeNull()
	await user.click(screen.getByRole('button', { name: 'Cancel' }))

	const removeButton = screen.getByRole('button', { name: 'Remove Salt' })
	expect(removeButton).toHaveClass('min-h-11', 'min-w-11')
	await user.click(removeButton)
	await user.click(screen.getByRole('button', { name: 'Confirm remove Salt' }))
	expect(await screen.findByText('Removing…')).toBeVisible()
	expect(screen.getByText('Salt')).toBeVisible()
	finishRemove?.()
	expect(
		await screen.findByText('Could not remove Salt. Try again.'),
	).toHaveAttribute('role', 'alert')
})

test('an empty list explains what a Staple is for', () => {
	const Stub = createRoutesStub([
		{ path: '/', Component: () => <ActiveStaples staples={[]} /> },
	])
	render(<Stub initialEntries={['/']} />)

	expect(screen.getByRole('heading', { name: 'No Staples yet' })).toBeVisible()
	expect(screen.queryByRole('list', { name: 'Staples' })).toBeNull()
	expect(screen.getByRole('button', { name: 'Add Staple' })).toBeVisible()
})
