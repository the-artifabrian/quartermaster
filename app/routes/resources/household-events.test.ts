import { RouterContextProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { getSessionExpirationDate } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { householdEventBus } from '#app/utils/household-events.server.ts'
import { createUser } from '#tests/db-utils.ts'
import { getSessionCookieHeader, BASE_URL } from '#tests/utils.ts'
import { loader } from './household-events.tsx'

const LOADER_ARGS_BASE = {
	params: {},
	context: new RouterContextProvider(),
	pattern: '/resources/household-events',
	url: new URL(`${BASE_URL}/resources/household-events`),
}

async function setupUser() {
	return prisma.$transaction(async (tx) => {
		const session = await tx.session.create({
			data: {
				expirationDate: getSessionExpirationDate(),
				user: {
					create: {
						...createUser(),
						subscription: { create: { tier: 'pro' } },
					},
				},
			},
			select: { id: true, userId: true },
		})
		const household = await tx.household.create({
			data: {
				name: 'Test Household',
				members: { create: { userId: session.userId, role: 'owner' } },
			},
		})
		return { ...session, householdId: household.id }
	})
}

async function makeStream() {
	const user = await setupUser()
	const cookie = await getSessionCookieHeader(user)
	const response = (await loader({
		...LOADER_ARGS_BASE,
		request: new Request(`${BASE_URL}/resources/household-events`, {
			headers: { cookie },
		}),
	})) as Response
	return { response, householdId: user.householdId }
}

function busListeners(householdId: string) {
	return householdEventBus.listenerCount(`household:${householdId}`)
}

afterEach(() => {
	vi.useRealTimers()
})

describe('household-events SSE loader', () => {
	test('streams a connected event and unsubscribes when the consumer cancels', async () => {
		const { response, householdId } = await makeStream()
		expect(busListeners(householdId)).toBe(1)

		const reader = response.body!.getReader()
		const { value } = await reader.read()
		expect(new TextDecoder().decode(value)).toContain('event: connected')

		await reader.cancel()
		expect(busListeners(householdId)).toBe(0)
	})

	test('cleans up a zombie stream whose consumer never drains', async () => {
		// The disconnect-without-abort case: the client is gone but neither
		// request.signal 'abort' nor cancel() ever fires, and nobody reads.
		vi.useFakeTimers()
		const { householdId } = await makeStream()
		expect(busListeners(householdId)).toBe(1)

		// First keepalive lands in the undrained queue.
		await vi.advanceTimersByTimeAsync(30_000)
		expect(busListeners(householdId)).toBe(1)

		// Next tick sees the queue never drained and tears everything down.
		await vi.advanceTimersByTimeAsync(30_000)
		expect(busListeners(householdId)).toBe(0)
	})

	test('keeps a draining consumer subscribed until the lifetime cap, then ends the stream', async () => {
		vi.useFakeTimers()
		const { response, householdId } = await makeStream()
		const reader = response.body!.getReader()
		await reader.read() // connected

		// Nine keepalive ticks (t=30s..270s), drained promptly each time.
		for (let i = 0; i < 9; i++) {
			await vi.advanceTimersByTimeAsync(30_000)
			await reader.read()
			expect(busListeners(householdId)).toBe(1)
		}

		// Ticks at t=300s and t=330s: the second crosses MAX_LIFETIME_MS and
		// closes the stream so the client re-connects with a fresh request.
		await vi.advanceTimersByTimeAsync(60_000)
		expect(busListeners(householdId)).toBe(0)
		await reader.read() // keepalive from the t=300s tick
		const { done } = await reader.read()
		expect(done).toBe(true)
	})
})
