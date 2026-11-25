/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { createRoutesStub, data, useFetcher } from 'react-router'
import { expect, test, vi } from 'vitest'
import { useFetcherSettled } from './use-fetcher-settled.ts'

type Answer = { n: number } | { status: 'error' }

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/**
 * A route whose action and loader wait until the test lets them finish, so
 * each fetcher state can be looked at on its own.
 */
async function setup({
	Component,
	strict = false,
}: {
	Component: () => React.ReactNode
	strict?: boolean
}) {
	const actions: Array<ReturnType<typeof deferred<unknown>>> = []
	const loads: Array<ReturnType<typeof deferred<null>>> = []
	let holdLoads = false
	const Stub = createRoutesStub([
		{
			path: '/',
			Component,
			ErrorBoundary: () => <p>Something went wrong</p>,
			HydrateFallback: () => <p>Loading</p>,
			loader: async () => {
				if (!holdLoads) return null
				const load = deferred<null>()
				loads.push(load)
				return load.promise
			},
			action: async () => {
				const action = deferred<unknown>()
				actions.push(action)
				return action.promise
			},
		},
	])
	const stub = <Stub initialEntries={['/']} />
	render(strict ? <StrictMode>{stub}</StrictMode> : stub)
	await screen.findByRole('button', { name: 'Save' })
	return {
		actions,
		loads,
		holdLoads: () => {
			holdLoads = true
		},
	}
}

function Probe({
	onSettled,
	fetcherKey,
}: {
	onSettled: (data: Answer | undefined) => void
	fetcherKey?: string
}) {
	const fetcher = useFetcher<Answer>(fetcherKey ? { key: fetcherKey } : {})
	useFetcherSettled(fetcher, onSettled)
	return (
		<>
			<button
				type="button"
				onClick={() => void fetcher.submit({ go: '1' }, { method: 'POST' })}
			>
				Save
			</button>
			<p>fetcher {fetcher.state}</p>
		</>
	)
}

async function settle(
	action: { resolve: (value: unknown) => void } | undefined,
	value: unknown,
) {
	expect(action).toBeDefined()
	await act(async () => action!.resolve(value))
	await screen.findByText('fetcher idle')
}

test('calls back once with the answer when a submit comes back', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await screen.findByText('fetcher submitting')
	expect(onSettled).not.toHaveBeenCalled()

	await settle(actions[0], { n: 1 })
	expect(onSettled).toHaveBeenCalledTimes(1)
	expect(onSettled).toHaveBeenCalledWith({ n: 1 })
})

test('waits for the revalidation after the submit before calling back', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions, loads, holdLoads } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})
	holdLoads()

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await act(async () => actions[0]!.resolve({ n: 1 }))
	await screen.findByText('fetcher loading')
	expect(onSettled).not.toHaveBeenCalled()

	await waitFor(() => expect(loads).toHaveLength(1))
	await act(async () => loads[0]!.resolve(null))
	await screen.findByText('fetcher idle')
	expect(onSettled).toHaveBeenCalledTimes(1)
	expect(onSettled).toHaveBeenCalledWith({ n: 1 })
})

test('calls back with an error answer the action returns', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await settle(actions[0], data({ status: 'error' }, { status: 400 }))
	expect(onSettled).toHaveBeenCalledTimes(1)
	expect(onSettled).toHaveBeenCalledWith({ status: 'error' })
})

test('never calls back when the action throws and the error page replaces the form', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await act(async () => actions[0]!.reject(new Response('No', { status: 500 })))
	await screen.findByText('Something went wrong')
	expect(onSettled).not.toHaveBeenCalled()
})

test('calls back once per submit when two run one after the other', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})
	const save = screen.getByRole('button', { name: 'Save' })

	await user.click(save)
	await waitFor(() => expect(actions).toHaveLength(1))
	await settle(actions[0], { n: 1 })
	await user.click(save)
	await waitFor(() => expect(actions).toHaveLength(2))
	await settle(actions[1], { n: 2 })

	expect(onSettled.mock.calls).toEqual([[{ n: 1 }], [{ n: 2 }]])
})

test('calls back once, with the second answer, when a second submit starts before the first comes back', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
	})
	const save = screen.getByRole('button', { name: 'Save' })

	await user.click(save)
	await waitFor(() => expect(actions).toHaveLength(1))
	await user.click(save)
	await waitFor(() => expect(actions).toHaveLength(2))
	await settle(actions[1], { n: 2 })
	await act(async () => actions[0]!.resolve({ n: 1 }))
	await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

	expect(onSettled.mock.calls).toEqual([[{ n: 2 }]])
})

test('does not call back on mount for a fetcher that already holds an answer', async () => {
	const user = userEvent.setup()
	const first = vi.fn()
	const second = vi.fn()
	function Page() {
		const [showSecond, setShowSecond] = useState(false)
		return (
			<>
				{showSecond ? (
					<Probe fetcherKey="shared" onSettled={second} />
				) : (
					<Probe fetcherKey="shared" onSettled={first} />
				)}
				<button type="button" onClick={() => setShowSecond(true)}>
					Swap
				</button>
			</>
		)
	}
	const { actions } = await setup({ Component: Page })

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await settle(actions[0], { n: 1 })
	expect(first).toHaveBeenCalledTimes(1)

	await user.click(screen.getByRole('button', { name: 'Swap' }))
	await screen.findByText('fetcher idle')
	expect(second).not.toHaveBeenCalled()
})

test('does not call back after the component unmounts mid-flight', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	function Page() {
		const [shown, setShown] = useState(true)
		return (
			<>
				{shown ? <Probe onSettled={onSettled} /> : <p>closed</p>}
				<button type="button" onClick={() => setShown(false)}>
					Close
				</button>
			</>
		)
	}
	const { actions } = await setup({ Component: Page })

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await user.click(screen.getByRole('button', { name: 'Close' }))
	await screen.findByText('closed')
	await act(async () => actions[0]!.resolve({ n: 1 }))
	await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
	expect(onSettled).not.toHaveBeenCalled()
})

test('calls back exactly once under strict mode, and not on mount', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	const { actions } = await setup({
		Component: () => <Probe onSettled={onSettled} />,
		strict: true,
	})

	await screen.findByText('fetcher idle')
	expect(onSettled).not.toHaveBeenCalled()

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await settle(actions[0], { n: 1 })
	expect(onSettled).toHaveBeenCalledTimes(1)
})

test('runs the callback from the latest render, and a re-render while idle calls nothing', async () => {
	const user = userEvent.setup()
	const onSettled = vi.fn()
	function Page() {
		const [label, setLabel] = useState('first')
		return (
			<>
				<Probe onSettled={(answer) => onSettled(label, answer)} />
				<button
					type="button"
					onClick={() => setLabel((current) => current + '+')}
				>
					Rename
				</button>
				<p>label {label}</p>
			</>
		)
	}
	const { actions } = await setup({ Component: Page })

	await user.click(screen.getByRole('button', { name: 'Save' }))
	await waitFor(() => expect(actions).toHaveLength(1))
	await user.click(screen.getByRole('button', { name: 'Rename' }))
	await screen.findByText('label first+')
	await settle(actions[0], { n: 1 })
	expect(onSettled.mock.calls).toEqual([['first+', { n: 1 }]])

	await user.click(screen.getByRole('button', { name: 'Rename' }))
	await screen.findByText('label first++')
	expect(onSettled).toHaveBeenCalledTimes(1)
})
