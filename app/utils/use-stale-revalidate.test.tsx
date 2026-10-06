/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
	Link,
	RouterProvider,
	createMemoryRouter,
	useLoaderData,
	useRevalidator,
} from 'react-router'
import { expect, test } from 'vitest'
import { useStaleRevalidate } from './use-stale-revalidate.ts'

// The same object every time: a revalidation that "brings nothing new" looks
// exactly like one a navigation cut short, apart from the location key.
const WEEK = { meals: ['tacos'] }

function Page() {
	const data = useLoaderData()
	useStaleRevalidate(data)
	const revalidator = useRevalidator()
	return (
		<>
			<p>revalidation {revalidator.state}</p>
			<button type="button" onClick={() => void revalidator.revalidate()}>
				Revalidate
			</button>
			<Link to="/?day=2026-10-22" replace>
				Pick a day
			</Link>
		</>
	)
}

function renderPage(loader: () => Promise<unknown>) {
	const router = createMemoryRouter(
		[
			{
				path: '/',
				loader,
				// Like Plan: a change of view-only params loads nothing.
				shouldRevalidate: ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
					currentUrl.search === nextUrl.search && defaultShouldRevalidate,
				Component: Page,
				HydrateFallback: () => null,
			},
		],
		{ initialEntries: ['/'] },
	)
	render(<RouterProvider router={router} />)
	return router
}

async function settle() {
	await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
}

test('a same-URL revalidation that ends with the same data does not revalidate again', async () => {
	const user = userEvent.setup()
	let calls = 0
	renderPage(async () => {
		calls++
		return WEEK
	})
	await screen.findByText('revalidation idle')
	expect(calls).toBe(1)

	await user.click(screen.getByRole('button', { name: 'Revalidate' }))
	await waitFor(() => expect(calls).toBe(2))
	await screen.findByText('revalidation idle')
	await settle()
	expect(calls).toBe(2)
})

test('a revalidation ended by a navigation that loaded nothing runs again, once', async () => {
	const user = userEvent.setup()
	let calls = 0
	const router = renderPage(async () => {
		calls++
		// The first revalidation hangs until the navigation aborts it.
		if (calls === 2) await new Promise(() => {})
		return WEEK
	})
	await screen.findByText('revalidation idle')

	await user.click(screen.getByRole('button', { name: 'Revalidate' }))
	await screen.findByText('revalidation loading')
	await user.click(screen.getByRole('link', { name: 'Pick a day' }))

	await waitFor(() => expect(calls).toBe(3))
	expect(router.state.location.search).toBe('?day=2026-10-22')
	await screen.findByText('revalidation idle')
	await settle()
	expect(calls).toBe(3)
})
