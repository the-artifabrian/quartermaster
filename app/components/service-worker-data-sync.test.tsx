/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { createRoutesStub, useFetcher } from 'react-router'
import { expect, test } from 'vitest'
import { loaderCache } from '#app/utils/loader-cache.ts'
import { ServiceWorkerDataSync } from './service-worker-data-sync.tsx'

const planRequest = new Request('https://useqm.app/plan')

async function cachePlan() {
	await loaderCache.load(
		{ request: planRequest, serverLoader: async () => ({ meals: [] }) },
		'/elsewhere',
	)
	expect(loaderCache.willServe(planRequest, '/elsewhere')).toBe(true)
}

function ShoppingPage({ userId }: { userId: string }) {
	const fetcher = useFetcher()
	return (
		<>
			<ServiceWorkerDataSync userId={userId} householdId="home" />
			<button
				onClick={() =>
					fetcher.submit(
						{ intent: 'toggle' },
						{ method: 'POST', action: '/shopping' },
					)
				}
			>
				Check milk
			</button>
			<p>{fetcher.state}</p>
		</>
	)
}

test('a Shopping submission drops the loader cache once it settles', async () => {
	const Stub = createRoutesStub([
		{
			path: '/shopping',
			Component: () => <ShoppingPage userId="alex" />,
			action: async () => ({ status: 'success' }),
		},
	])
	render(<Stub initialEntries={['/shopping']} />)
	await screen.findByText('idle')
	await cachePlan()

	await userEvent.click(screen.getByRole('button', { name: 'Check milk' }))
	await waitFor(() =>
		expect(loaderCache.willServe(planRequest, '/elsewhere')).toBe(false),
	)
})

test('switching user or signing out drops the loader cache', async () => {
	function Page() {
		const [userId, setUserId] = useState<string | null>('alex')
		return (
			<>
				<ServiceWorkerDataSync userId={userId} householdId="home" />
				<button onClick={() => setUserId('sam')}>Switch to Sam</button>
				<button onClick={() => setUserId(null)}>Log out</button>
			</>
		)
	}
	const Stub = createRoutesStub([{ path: '/plan', Component: Page }])
	render(<Stub initialEntries={['/plan']} />)
	await screen.findByRole('button', { name: 'Log out' })
	await cachePlan()

	await userEvent.click(screen.getByRole('button', { name: 'Switch to Sam' }))
	await waitFor(() =>
		expect(loaderCache.willServe(planRequest, '/elsewhere')).toBe(false),
	)

	await cachePlan()
	await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
	await waitFor(() =>
		expect(loaderCache.willServe(planRequest, '/elsewhere')).toBe(false),
	)
})
