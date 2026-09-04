/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createRoutesStub, useLoaderData } from 'react-router'
import { expect, test } from 'vitest'
import { ActiveStaples } from './staples-cutover.tsx'

const largeStapleList = [
	{ id: 'rice', displayName: 'Brown rice', isOut: true },
	{ id: 'salt', displayName: 'Salt', isOut: true },
	{ id: 'apples', displayName: 'Apples', isOut: false },
	{ id: 'beans', displayName: 'Beans', isOut: false },
	{ id: 'coffee', displayName: 'Coffee', isOut: false },
	{ id: 'eggs', displayName: 'Eggs', isOut: false },
	{ id: 'flour', displayName: 'Flour', isOut: false },
	{ id: 'garlic', displayName: 'Garlic', isOut: false },
	{ id: 'milk', displayName: 'Milk', isOut: false },
	{ id: 'oats', displayName: 'Oats', isOut: false },
	{ id: 'oil', displayName: 'Olive oil', isOut: false },
	{ id: 'pasta', displayName: 'Pasta', isOut: false },
	{ id: 'pepper', displayName: 'Pepper', isOut: false },
	{ id: 'tea', displayName: 'Tea', isOut: false },
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

test('large Staple lists put the Out task first and search both groups', async () => {
	renderStaples()
	const user = userEvent.setup()

	const outGroup = screen.getByRole('region', { name: 'Out' })
	const availableGroup = screen.getByRole('region', {
		name: 'Usually available',
	})
	expect(outGroup).toHaveTextContent('Waiting in Next shop')
	expect(within(outGroup).getByLabelText('2 Out Staples')).toBeVisible()
	expect(
		within(availableGroup).getByLabelText('12 usually available Staples'),
	).toBeVisible()
	expect(
		outGroup.compareDocumentPosition(availableGroup) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy()
	expect(within(outGroup).getAllByRole('listitem')).toHaveLength(2)
	expect(within(outGroup).getAllByRole('listitem')[0]).toHaveTextContent(
		'Brown rice',
	)
	expect(
		within(outGroup).getByRole('button', {
			name: 'Mark Brown rice available',
		}),
	).toHaveTextContent('Available')
	expect(
		within(availableGroup).getByRole('button', { name: 'Mark Apples Out' }),
	).toHaveTextContent('Out')

	expect(screen.queryByRole('textbox', { name: 'Add a Staple' })).toBeNull()
	await user.click(screen.getByRole('button', { name: 'Add Staple' }))
	expect(screen.getByRole('textbox', { name: 'Add a Staple' })).toBeVisible()

	const search = screen.getByRole('searchbox', { name: 'Search Staples' })
	await user.type(search, 'rice')
	expect(within(outGroup).getByLabelText('1 Out Staple')).toBeVisible()
	expect(
		within(availableGroup).getByLabelText('0 usually available Staples'),
	).toBeVisible()
	expect(screen.getByText('Brown rice')).toBeVisible()
	expect(screen.queryByText('Apples')).toBeNull()

	await user.clear(search)
	await user.type(search, 'something missing')
	expect(
		screen.getByRole('heading', { name: 'No Staples found' }),
	).toBeVisible()
	await user.click(screen.getByRole('button', { name: 'Clear search' }))
	expect(screen.getByText('Brown rice')).toBeVisible()

	expect(screen.getByText('Advanced')).toBeVisible()
	expect(screen.queryByText(/legacy Pantry item/)).toBeNull()
})

test('marking a Staple Out moves it immediately, restores focus, and announces the result', async () => {
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
						? { ...staple, isOut: !staple.isOut }
						: staple,
				)
				return {
					status: 'success',
					action: 'toggle-staple-out',
					message: 'Apples was added to Next shop.',
				}
			},
		},
	])
	render(<Stub initialEntries={['/']} />)
	const user = userEvent.setup()

	await user.click(
		await screen.findByRole('button', { name: 'Mark Apples Out' }),
	)
	const optimisticButton = await screen.findByRole('button', {
		name: 'Mark Apples available',
	})
	expect(
		within(screen.getByRole('region', { name: 'Out' })).getByText('Apples'),
	).toBeVisible()
	expect(optimisticButton).toHaveFocus()

	finishAction?.()
	await waitFor(() => expect(optimisticButton).not.toHaveAttribute('aria-busy'))
	expect(screen.getByRole('status')).toHaveTextContent(
		'Apples was added to Next shop.',
	)
	expect(
		screen.getByRole('button', { name: 'Mark Apples available' }),
	).toHaveFocus()
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
					staples={[{ id: 'salt', displayName: 'Salt', isOut: false }]}
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

	expect(
		within(screen.getByRole('region', { name: 'Out' })).getByText(
			'Nothing is Out.',
		),
	).toBeVisible()
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
