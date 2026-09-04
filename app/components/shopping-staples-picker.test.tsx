/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { createRoutesStub } from 'react-router'
import { expect, test } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import { ShoppingStaplesPicker } from './shopping-staples-picker.tsx'

test('loads Staple choices once per Shopping screen and derives current list state', async () => {
	let requestCount = 0
	let releaseResponse = () => {}
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve
	})
	server.use(
		http.get('*/resources/shopping-staples', async () => {
			requestCount += 1
			await responseGate
			return HttpResponse.json({
				staples: [
					{
						id: 'milk',
						displayName: 'Milk',
						shoppingIdentity: 'milk',
					},
					{
						id: 'salt',
						displayName: 'Salt',
						shoppingIdentity: 'salt',
					},
				],
			})
		}),
	)
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ShoppingStaplesPicker
					shoppingIdentities={['salt']}
					showQuietCue={false}
				/>
			),
		},
	])
	const user = userEvent.setup()
	render(<Stub initialEntries={['/']} />)

	await user.click(screen.getByRole('button', { name: 'From Staples' }))
	expect(screen.getByRole('status')).toHaveTextContent('Loading Staples')
	releaseResponse()
	await waitFor(() =>
		expect(
			screen.getByRole('button', { name: /Salt.*On list/ }),
		).toBeDisabled(),
	)
	expect(screen.getByRole('button', { name: 'Milk' })).toBeEnabled()

	await user.click(screen.getByRole('button', { name: 'From Staples' }))
	await user.click(screen.getByRole('button', { name: 'From Staples' }))
	expect(screen.getByRole('button', { name: /Salt.*On list/ })).toBeDisabled()
	expect(requestCount).toBe(1)
})

test('offers an accessible retry and empty state after a choice request fails', async () => {
	let requestCount = 0
	let releaseRetry = () => {}
	const retryGate = new Promise<void>((resolve) => {
		releaseRetry = resolve
	})
	server.use(
		http.get('*/resources/shopping-staples', async () => {
			requestCount += 1
			if (requestCount === 1) {
				return new HttpResponse(null, { status: 503 })
			}
			await retryGate
			return HttpResponse.json({ staples: [] })
		}),
	)
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ShoppingStaplesPicker shoppingIdentities={[]} showQuietCue={false} />
			),
		},
	])
	const user = userEvent.setup()
	render(<Stub initialEntries={['/']} />)

	await user.click(screen.getByRole('button', { name: 'From Staples' }))
	const failure = await screen.findByRole('alert')
	expect(failure).toHaveTextContent('Couldn’t load Staples')
	await user.click(screen.getByRole('button', { name: 'Try again' }))
	expect(screen.getByRole('status')).toHaveTextContent('Loading Staples')
	releaseRetry()
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent('No Staples yet'),
	)
	expect(requestCount).toBe(2)
})

test('selects available Staples in one batch and quietly dismisses the empty-list cue', async () => {
	const submissions: Array<Record<string, FormDataEntryValue>> = []
	server.use(
		http.get('*/resources/shopping-staples', () =>
			HttpResponse.json({
				staples: [
					{
						id: 'milk',
						displayName: 'Milk',
						shoppingIdentity: 'milk',
					},
					{
						id: 'yogurt',
						displayName: 'Yogurt',
						shoppingIdentity: 'greek yogurt',
					},
					{
						id: 'salt',
						displayName: 'Salt',
						shoppingIdentity: 'salt',
					},
				],
			}),
		),
	)
	const Stub = createRoutesStub([
		{
			path: '/',
			Component: () => (
				<ShoppingStaplesPicker shoppingIdentities={['salt']} showQuietCue />
			),
			action: async ({ request }) => {
				const submitted = Object.fromEntries(await request.formData())
				submissions.push(submitted)
				return { status: 'success', addedCount: 2, moveItemIds: [] }
			},
		},
	])
	const user = userEvent.setup()
	render(<Stub initialEntries={['/']} />)

	await user.click(
		screen.getByRole('button', {
			name: 'From Staples, reminder available',
		}),
	)
	expect(screen.getByRole('button', { name: 'From Staples' })).toBeVisible()
	expect(
		screen.getByRole('heading', { name: 'What do you need this trip?' }),
	).toBeVisible()
	expect(
		await screen.findByRole('button', { name: /Salt.*On list/ }),
	).toBeDisabled()

	await user.click(screen.getByRole('button', { name: 'Milk' }))
	await user.click(screen.getByRole('button', { name: 'Yogurt' }))
	await user.click(screen.getByRole('button', { name: 'Add 2 to Next shop' }))

	await waitFor(() =>
		expect(submissions).toContainEqual({
			intent: 'bulk-add',
			horizon: 'next',
			items: JSON.stringify([{ name: 'Milk' }, { name: 'Yogurt' }]),
		}),
	)
	await waitFor(() =>
		expect(
			screen.queryByRole('heading', { name: 'What do you need this trip?' }),
		).not.toBeInTheDocument(),
	)
})
