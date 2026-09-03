/**
 * @vitest-environment jsdom
 */
import { act, render, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { NavTiming } from './nav-timing.tsx'

const analytics = vi.hoisted(() => ({ capture: vi.fn() }))

vi.mock('#app/utils/posthog-provider.tsx', () => ({
	usePostHog: () => analytics,
}))
vi.mock('#app/utils/nav-resource-timing.ts', () => ({
	readDataTiming: () => null,
}))

beforeEach(() => vi.clearAllMocks())

test('reports stable route ids rather than dynamic pathnames', async () => {
	let finishLoader: (value: null) => void = () => undefined
	const loader = new Promise<null>((resolve) => {
		finishLoader = resolve
	})
	const router = createMemoryRouter(
		[
			{
				id: 'root',
				path: '/',
				element: (
					<>
						<NavTiming />
						<Outlet />
					</>
				),
				children: [
					{
						id: 'routes/_marketing/index',
						index: true,
						element: <div>Home</div>,
					},
					{
						id: 'routes/recipes/$recipeId',
						path: 'recipes/:recipeId',
						loader: () => loader,
						element: <div>Recipe</div>,
					},
				],
			},
		],
		{ initialEntries: ['/'] },
	)
	render(<RouterProvider router={router} />)

	let navigation: Promise<void>
	act(() => {
		navigation = router.navigate('/recipes/private-record-id')
	})
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))
	await act(async () => {
		finishLoader(null)
		await navigation
	})

	await waitFor(() =>
		expect(analytics.capture).toHaveBeenCalledWith(
			'nav_duration_ms',
			expect.objectContaining({
				from_route: 'routes/_marketing/index',
				to_route: 'routes/recipes/$recipeId',
			}),
		),
	)
	const properties = analytics.capture.mock.calls[0]?.[1]
	expect(properties).not.toHaveProperty('from')
	expect(properties).not.toHaveProperty('to')
	expect(JSON.stringify(properties)).not.toContain('private-record-id')
})
