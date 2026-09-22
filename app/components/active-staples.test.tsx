/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { ActiveStaples } from './active-staples.tsx'

const largeStapleList = [
	{ id: 'rice', displayName: 'Brown rice' },
	{ id: 'salt', displayName: 'Salt' },
	{ id: 'apples', displayName: 'Apples' },
	{ id: 'beans', displayName: 'Beans' },
	{ id: 'coffee', displayName: 'Coffee' },
	{ id: 'eggs', displayName: 'Eggs' },
	{ id: 'flour', displayName: 'Flour' },
	{ id: 'garlic', displayName: 'Garlic' },
	{ id: 'milk', displayName: 'Milk' },
	{ id: 'oats', displayName: 'Oats' },
	{ id: 'oil', displayName: 'Olive oil' },
	{ id: 'pasta', displayName: 'Pasta' },
	{ id: 'pepper', displayName: 'Pepper' },
	{ id: 'tea', displayName: 'Tea' },
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
	// One tap is the whole interaction; nothing states an availability.
	expect(
		within(list).getByRole('button', { name: 'Add Apples to Next shop' }),
	).toBeVisible()
	expect(list).not.toHaveTextContent('Out')
	expect(list).not.toHaveTextContent('Available')

	const search = screen.getByRole('searchbox', { name: 'Search Staples' })
	const addButton = screen.getByRole('button', { name: 'Add Staple' })
	expect(search).toBeVisible()
	// The feedback line holds its space so a tap never moves the list.
	expect(screen.getByRole('status')).toHaveClass('min-h-5')
	expect(screen.getByRole('status')).toBeEmptyDOMElement()
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

test('tapping a Staple keeps it in place, holds focus, and announces the result', async () => {
	let finishAction: (() => void) | undefined
	const actionCanFinish = new Promise<void>((resolve) => {
		finishAction = resolve
	})
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => <ActiveStaples staples={largeStapleList} />,
			HydrateFallback: () => null,
			loader: () => ({}),
			action: async () => {
				await actionCanFinish
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
	expect(screen.getByRole('status')).toHaveTextContent(
		'Adding Apples to Next shop…',
	)
	// The row does not move or disappear — this list is not a queue.
	expect(
		within(screen.getByRole('list', { name: 'Staples' })).getAllByRole(
			'listitem',
		)[0],
	).toHaveTextContent('Apples')

	finishAction?.()
	await waitFor(() => expect(appleButton).not.toHaveAttribute('aria-busy'))
	expect(screen.getByRole('status')).toHaveTextContent(
		'Apples was added to Next shop.',
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
				<ActiveStaples staples={[{ id: 'salt', displayName: 'Salt' }]} />
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
