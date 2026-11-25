import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createUndoStore, type UndoStoreJob } from './undo-delete.ts'

const RELEASE_MS = 3000
const ENTER_MS = 1500

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

const setup = () =>
	createUndoStore({ releaseMs: RELEASE_MS, enterMs: ENTER_MS })

function job(overrides: Partial<UndoStoreJob> = {}): UndoStoreJob {
	return {
		key: 'milk',
		hides: ['milk'],
		del: async () => ({ status: 'deleted', snapshot: { kind: 'x' } }),
		restore: async () => 'restored',
		onDeleteFailed: vi.fn(),
		onRestoreFailed: vi.fn(),
		onRestoreGone: vi.fn(),
		...overrides,
	}
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('delete', () => {
	test('hides the rows at once; a failed delete shows them again and says so', async () => {
		const store = setup()
		const sending = deferred<never>()
		const onDeleteFailed = vi.fn()
		store.start(job({ del: () => sending.promise, onDeleteFailed }))
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
		sending.reject(new Error('offline'))
		await flush()
		expect(store.getSnapshot().hidden.has('milk')).toBe(false)
		expect(onDeleteFailed).toHaveBeenCalledTimes(1)
	})

	test('a delete that finds nothing leaves the rows hidden', async () => {
		const store = setup()
		store.start(job({ del: async () => ({ status: 'gone' }) }))
		await flush()
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
	})
})

describe('undo', () => {
	test('after the delete has answered, sends its snapshot back and the row comes back opening', async () => {
		const store = setup()
		const restore = vi.fn(async () => 'restored' as const)
		store.start(job({ restore }))
		await flush()
		expect(store.undo('milk')).toBe(true)
		await flush()
		expect(restore).toHaveBeenCalledWith({ kind: 'x' })
		expect(store.getSnapshot().hidden.has('milk')).toBe(false)
		expect(store.getSnapshot().entering.has('milk')).toBe(true)
		await vi.advanceTimersByTimeAsync(ENTER_MS)
		expect(store.getSnapshot().entering.has('milk')).toBe(false)
	})

	test('while the delete is on its way, waits for it and then restores', async () => {
		const store = setup()
		const sending = deferred<{ status: 'deleted'; snapshot: unknown }>()
		const restore = vi.fn(async () => 'restored' as const)
		store.start(job({ del: () => sending.promise, restore }))
		expect(store.undo('milk')).toBe(true)
		await flush()
		expect(restore).not.toHaveBeenCalled()
		sending.resolve({ status: 'deleted', snapshot: { kind: 'x' } })
		await flush()
		expect(restore).toHaveBeenCalledTimes(1)
		expect(store.getSnapshot().hidden.has('milk')).toBe(false)
	})

	test('of a delete that failed or found nothing restores nothing', async () => {
		const store = setup()
		const restore = vi.fn(async () => 'restored' as const)
		store.start(
			job({
				key: 'failed',
				del: async () => {
					throw new Error('offline')
				},
				restore,
			}),
		)
		store.start(
			job({ key: 'gone', del: async () => ({ status: 'gone' }), restore }),
		)
		await flush()
		expect(store.undo('failed')).toBe(false)
		expect(store.undo('gone')).toBe(false)
		await flush()
		expect(restore).not.toHaveBeenCalled()
	})

	test('a double tap restores once', async () => {
		const store = setup()
		const restore = vi.fn(async () => 'restored' as const)
		store.start(job({ restore }))
		await flush()
		store.undo('milk')
		store.undo('milk')
		await flush()
		expect(restore).toHaveBeenCalledTimes(1)
	})
})

describe('restore', () => {
	test('that fails leaves the rows deleted and says so', async () => {
		const store = setup()
		const onRestoreFailed = vi.fn()
		store.start(
			job({
				restore: async () => {
					throw new Error('offline')
				},
				onRestoreFailed,
			}),
		)
		await flush()
		store.undo('milk')
		await flush()
		expect(onRestoreFailed).toHaveBeenCalledTimes(1)
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
	})

	test('whose target has gone says so', async () => {
		const store = setup()
		const onRestoreGone = vi.fn()
		store.start(job({ restore: async () => 'gone', onRestoreGone }))
		await flush()
		store.undo('milk')
		await flush()
		expect(onRestoreGone).toHaveBeenCalledTimes(1)
	})
})

describe('closing the toast', () => {
	// By then the refreshed list doesn't have them.
	test('ends Undo, and lets the rows go a beat later', async () => {
		const store = setup()
		const restore = vi.fn(async () => 'restored' as const)
		store.start(job({ restore }))
		await flush()
		store.close('milk')
		expect(store.undo('milk')).toBe(false)
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
		await vi.advanceTimersByTimeAsync(RELEASE_MS)
		expect(store.getSnapshot().hidden.has('milk')).toBe(false)
		expect(restore).not.toHaveBeenCalled()
	})

	test('while the delete is on its way lets the rows go once it answers', async () => {
		const store = setup()
		const sending = deferred<{ status: 'deleted'; snapshot: unknown }>()
		store.start(job({ del: () => sending.promise }))
		store.close('milk')
		await vi.advanceTimersByTimeAsync(RELEASE_MS * 2)
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
		sending.resolve({ status: 'deleted', snapshot: {} })
		await flush()
		await vi.advanceTimersByTimeAsync(RELEASE_MS)
		expect(store.getSnapshot().hidden.has('milk')).toBe(false)
	})
})

test('the snapshot keeps its identity until something changes', async () => {
	const store = setup()
	const listener = vi.fn()
	store.subscribe(listener)
	const first = store.getSnapshot()
	expect(store.getSnapshot()).toBe(first)
	store.start(job({ hides: ['milk', 'eggs'], style: 'instant' }))
	const second = store.getSnapshot()
	expect(second).not.toBe(first)
	expect([...second.hidden]).toEqual([
		['milk', 'instant'],
		['eggs', 'instant'],
	])
	expect(listener).toHaveBeenCalled()
	await flush()
	expect(store.getSnapshot()).toBe(second)
})

describe('ending', () => {
	test('a failed or gone restore lets its rows go once the toast has closed', async () => {
		const store = setup()
		store.start(
			job({
				key: 'failed',
				hides: ['a'],
				restore: async () => {
					throw new Error('offline')
				},
			}),
		)
		store.start(job({ key: 'gone', hides: ['b'], restore: async () => 'gone' }))
		await flush()
		for (const key of ['failed', 'gone']) {
			store.undo(key)
			store.close(key)
		}
		await flush()
		await vi.advanceTimersByTimeAsync(RELEASE_MS)
		expect(store.getSnapshot().hidden.size).toBe(0)
	})

	test('a double tap is one delete; a closed job is replaced by a new one', async () => {
		const store = setup()
		const del = vi.fn(async () => ({
			status: 'deleted' as const,
			snapshot: {},
		}))
		store.start(job({ del }))
		store.start(job({ del }))
		await flush()
		expect(del).toHaveBeenCalledTimes(1)
		store.close('milk')
		store.start(job({ del }))
		await flush()
		expect(del).toHaveBeenCalledTimes(2)
	})

	test("letting an old job go never takes the new one's rows", async () => {
		const store = setup()
		store.start(job())
		await flush()
		store.close('milk')
		store.start(job())
		await flush()
		await vi.advanceTimersByTimeAsync(RELEASE_MS)
		expect(store.getSnapshot().hidden.has('milk')).toBe(true)
	})

	test('a failed restore does not stay stuck: the same thing can be deleted again', async () => {
		const store = setup()
		const del = vi.fn(async () => ({
			status: 'deleted' as const,
			snapshot: {},
		}))
		store.start(
			job({
				del,
				restore: async () => {
					throw new Error('offline')
				},
			}),
		)
		await flush()
		store.undo('milk')
		store.close('milk')
		await flush()
		store.start(job({ del }))
		await flush()
		expect(del).toHaveBeenCalledTimes(2)
	})
})

test('a delete counts as still out until its toast closes or it is put back', async () => {
	const store = setup()
	store.start(job())
	expect(store.active('milk')).toBe(true)
	await flush()
	expect(store.active('milk')).toBe(true)
	store.close('milk')
	expect(store.active('milk')).toBe(false)
	store.start(job({ key: 'eggs', hides: ['eggs'] }))
	await flush()
	store.undo('eggs')
	await flush()
	expect(store.active('eggs')).toBe(false)
})
