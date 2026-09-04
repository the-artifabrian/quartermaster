/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
	createMemoryRouter,
	Outlet,
	RouterProvider,
	type RouteObject,
	useNavigate,
} from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import { NavTiming, useBottomNavTiming } from './nav-timing.tsx'

const analytics = vi.hoisted(() => ({ capture: vi.fn() }))
const resourceTiming = vi.hoisted(() => ({ readDataTiming: vi.fn(() => null) }))

vi.mock('#app/utils/posthog-provider.tsx', () => ({
	usePostHog: () => analytics,
}))
vi.mock('#app/utils/nav-resource-timing.ts', () => resourceTiming)

beforeEach(() => vi.clearAllMocks())

function createTestRouter(children: RouteObject[]) {
	return createMemoryRouter(
		[
			{
				id: 'root',
				path: '/',
				element: (
					<NavTiming>
						<Outlet />
					</NavTiming>
				),
				children,
			},
		],
		{ initialEntries: ['/'] },
	)
}

function BottomNavTestTrigger() {
	const navigate = useNavigate()
	const timing = useBottomNavTiming()
	return (
		<button
			onClick={() => {
				timing.begin({
					destination: 'plan',
					destinationPath: '/plan?private=value',
					tabPath: '/plan',
					startedAt: 50,
				})
				void navigate('/plan?private=value')
			}}
		>
			Plan
		</button>
	)
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

test('reports stable route ids rather than dynamic pathnames', async () => {
	const loader = deferred<null>()
	const router = createTestRouter([
		{
			id: 'routes/_marketing/index',
			index: true,
			element: <div>Home</div>,
		},
		{
			id: 'routes/recipes/$recipeId',
			path: 'recipes/:recipeId',
			loader: () => loader.promise,
			element: <div>Recipe</div>,
		},
	])
	render(<RouterProvider router={router} />)

	let navigation: Promise<void>
	act(() => {
		navigation = router.navigate('/recipes/private-record-id')
	})
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))
	await act(async () => {
		loader.resolve(null)
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
	expect(properties).not.toHaveProperty('navigation_source')
	expect(properties).not.toHaveProperty('destination_tab')
	expect(properties).not.toHaveProperty('input_to_idle_ms')
	expect(JSON.stringify(properties)).not.toContain('private-record-id')
})

test('includes the action submission in the user-visible navigation duration', async () => {
	const action = deferred<null>()
	const loader = deferred<null>()
	const router = createTestRouter([
		{ index: true, element: <div>Home</div> },
		{
			id: 'routes/save',
			path: 'save',
			action: () => action.promise,
			loader: () => loader.promise,
			element: <div>Saved</div>,
		},
	])
	let now = 100
	vi.spyOn(performance, 'now').mockImplementation(() => now)
	render(<RouterProvider router={router} />)

	let navigation: Promise<void>
	act(() => {
		navigation = router.navigate('/save', {
			formMethod: 'post',
			formData: new FormData(),
		})
	})
	await waitFor(() => expect(router.state.navigation.state).toBe('submitting'))

	now = 400
	act(() => action.resolve(null))
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))

	now = 600
	await act(async () => {
		loader.resolve(null)
		await navigation
	})

	await waitFor(() =>
		expect(analytics.capture).toHaveBeenCalledWith(
			'nav_duration_ms',
			expect.objectContaining({
				duration_ms: 500,
				to_route: 'routes/save',
			}),
		),
	)
})

test('adds low-cardinality BottomNav input-to-idle context to the existing event', async () => {
	const loader = deferred<null>()
	const router = createTestRouter([
		{
			index: true,
			element: <BottomNavTestTrigger />,
		},
		{
			id: 'routes/plan/index',
			path: 'plan',
			loader: () => loader.promise,
			element: <div>Meal plan</div>,
		},
	])
	let now = 100
	vi.spyOn(performance, 'now').mockImplementation(() => now)
	render(<RouterProvider router={router} />)

	fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
	await waitFor(() => expect(router.state.navigation.state).toBe('loading'))
	now = 600
	loader.resolve(null)
	await waitFor(() => expect(router.state.navigation.state).toBe('idle'))

	await waitFor(() =>
		expect(analytics.capture).toHaveBeenCalledWith('nav_duration_ms', {
			duration_ms: 500,
			from_route: '0-0',
			to_route: 'routes/plan/index',
			effective_type: undefined,
			rtt: undefined,
			navigation_source: 'bottom_nav',
			destination_tab: 'plan',
			input_to_idle_ms: 550,
		}),
	)
	expect(JSON.stringify(analytics.capture.mock.calls[0]?.[1])).not.toContain(
		'private',
	)
})

test('attributes an interrupted navigation to its final destination', async () => {
	const slowLoader = deferred<null>()
	const finalLoader = deferred<null>()
	const router = createTestRouter([
		{ index: true, element: <div>Home</div> },
		{
			id: 'routes/slow',
			path: 'slow',
			loader: () => slowLoader.promise,
			element: <div>Slow</div>,
		},
		{
			id: 'routes/final',
			path: 'final',
			loader: () => finalLoader.promise,
			element: <div>Final</div>,
		},
	])
	render(<RouterProvider router={router} />)

	let firstNavigation = Promise.resolve()
	act(() => {
		firstNavigation = router.navigate('/slow')
	})
	await waitFor(() =>
		expect(router.state.navigation.location?.pathname).toBe('/slow'),
	)

	let finalNavigation: Promise<void>
	act(() => {
		finalNavigation = router.navigate('/final')
	})
	await waitFor(() =>
		expect(router.state.navigation.location?.pathname).toBe('/final'),
	)
	await act(async () => {
		finalLoader.resolve(null)
		await finalNavigation
	})
	slowLoader.resolve(null)
	await firstNavigation

	await waitFor(() =>
		expect(resourceTiming.readDataTiming).toHaveBeenCalledWith(
			expect.any(Number),
			'/final',
		),
	)
	expect(analytics.capture).toHaveBeenCalledWith(
		'nav_duration_ms',
		expect.objectContaining({ to_route: 'routes/final' }),
	)
})
