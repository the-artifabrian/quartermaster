import { useEffect, useReducer, useRef } from 'react'
import { useBlocker } from 'react-router'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
import { type DisplayShoppingItem } from '#app/utils/shopping-optimistic.ts'

type Item = DisplayShoppingItem
type SentCheck = {
	checked: boolean
	observedVersion: number
	mutationId: string
}
type PendingCheck = {
	item: Item
	desired: boolean
	status: 'saving' | 'reconciling' | 'failed'
	sent?: SentCheck
	running: boolean
	controller?: AbortController
}
type CheckResponse = {
	status: 'success' | 'conflict' | 'missing' | 'denied' | 'invalid'
	item?: Item
}

/** Page-local checkbox work. Filtering/hiding a row does not discard its intent. */
export function useShoppingChecks(serverItems: Item[], listId: string) {
	const [, redraw] = useReducer((n: number) => n + 1, 0)
	const pending = useRef(new Map<string, PendingCheck>())
	const confirmed = useRef(new Map<string, Item | null>())
	const notices = useRef(new Map<string, string>())
	const active = useRef(false)
	const currentList = useRef(listId)
	const sameList = currentList.current === listId

	useEffect(() => {
		currentList.current = listId
		active.current = true
		const work = pending.current
		const snapshots = confirmed.current
		const messages = notices.current
		return () => {
			active.current = false
			for (const entry of work.values()) entry.controller?.abort()
			work.clear()
			snapshots.clear()
			messages.clear()
		}
	}, [listId])

	useEffect(() => {
		const ids = new Set(serverItems.map((item) => item.id))
		for (const id of confirmed.current.keys()) {
			if (!ids.has(id) && !pending.current.has(id)) confirmed.current.delete(id)
		}
		for (const item of serverItems) {
			const known = confirmed.current.get(item.id)
			if (
				known === undefined ||
				(known && item.checkVersion >= known.checkVersion)
			) {
				confirmed.current.set(item.id, item)
			}
		}
		// A background refresh may resolve an uncertain write while its local
		// Retry is idle. Never keep offering an old check for changed demand.
		for (const [id, entry] of pending.current) {
			if (entry.running) continue
			const item = ids.has(id) ? confirmed.current.get(id) : null
			if (!item) {
				pending.current.delete(id)
				notices.current.set(id, `${entry.item.name}: This item was removed.`)
			} else if (item.checkVersion > entry.item.checkVersion) {
				const sent = entry.sent
				const ownCommit =
					sent &&
					item.checkVersion === sent.observedVersion + 1 &&
					item.lastCheckMutationId === sent.mutationId &&
					item.checked === sent.checked
				if (ownCommit && entry.desired !== item.checked) {
					entry.item = item
					entry.sent = undefined
				} else {
					pending.current.delete(id)
					if (!ownCommit)
						notices.current.set(
							id,
							`${item.name}: This item changed. Check its current amount before checking again.`,
						)
				}
			}
		}
		redraw()
	}, [serverItems, listId])

	const blocker = useBlocker(
		({ currentLocation, nextLocation }) =>
			pending.current.size > 0 &&
			currentLocation.pathname !== nextLocation.pathname,
	)
	useEffect(() => {
		if (blocker.state !== 'blocked') return
		if (
			window.confirm(
				'Some Shopping checks aren’t confirmed. Leave and discard your pending changes?',
			)
		) {
			blocker.proceed()
		} else blocker.reset()
	}, [blocker])

	function stillActive(entry: PendingCheck) {
		return (
			active.current &&
			currentList.current === listId &&
			pending.current.get(entry.item.id) === entry
		)
	}

	function finish(entry: PendingCheck, item: Item | null, message?: string) {
		if (!stillActive(entry)) return
		confirmed.current.set(entry.item.id, item)
		pending.current.delete(entry.item.id)
		if (message)
			notices.current.set(entry.item.id, `${entry.item.name}: ${message}`)
		redraw()
	}

	async function request(
		entry: PendingCheck,
		sent?: SentCheck,
	): Promise<CheckResponse> {
		const controller = new AbortController()
		entry.controller = controller
		const timeout = setTimeout(() => controller.abort(), 8_000)
		try {
			const response = await fetch(
				`/resources/shopping-check?itemId=${encodeURIComponent(entry.item.id)}`,
				{
					method: sent ? 'POST' : 'GET',
					cache: 'no-store',
					redirect: 'error',
					signal: controller.signal,
					...(sent
						? {
								body: new URLSearchParams({
									itemId: entry.item.id,
									checked: String(sent.checked),
									observedVersion: String(sent.observedVersion),
									mutationId: sent.mutationId,
									originClientId: getHouseholdClientId(),
								}),
							}
						: {}),
				},
			)
			if (response.status >= 500) throw new Error('Shopping is unavailable')
			const result = (await response.json()) as CheckResponse
			if (result.item) result.item.createdAt = new Date(result.item.createdAt)
			return result
		} finally {
			clearTimeout(timeout)
		}
	}

	async function run(entry: PendingCheck, reconcileFirst = false) {
		if (entry.running) return
		entry.running = true
		entry.status = 'saving'
		redraw()
		let retries = 0
		let reconcile = reconcileFirst
		try {
			while (stillActive(entry)) {
				const sent = (entry.sent ??= {
					checked: entry.desired,
					observedVersion: entry.item.checkVersion,
					mutationId: crypto.randomUUID(),
				})
				let result: CheckResponse
				if (reconcile) {
					entry.status = 'reconciling'
					redraw()
					result = await request(entry)
				} else {
					if (document.hidden) throw new Error('Page is inactive')
					entry.status = 'saving'
					redraw()
					try {
						result = await request(entry, sent)
					} catch {
						if (!stillActive(entry)) return
						// The server may have committed. Always read before replaying.
						reconcile = true
						continue
					}
				}
				if (!stillActive(entry)) return
				if (
					result.status === 'missing' ||
					result.status === 'denied' ||
					result.status === 'invalid'
				) {
					finish(
						entry,
						result.status === 'missing' ? null : entry.item,
						result.status === 'missing'
							? 'This item was removed.'
							: 'Couldn’t confirm this check. Reload Shopping to continue.',
					)
					return
				}
				if (!result.item) throw new Error('Invalid Shopping response')
				const known = confirmed.current.get(entry.item.id)
				const current =
					known && known.checkVersion > result.item.checkVersion
						? known
						: result.item
				const ownCommit =
					current.checkVersion === sent.observedVersion + 1 &&
					current.lastCheckMutationId === sent.mutationId &&
					current.checked === sent.checked
				const unchanged = current.checkVersion === sent.observedVersion
				if (
					result.status !== 'conflict' &&
					(ownCommit || (unchanged && current.checked === sent.checked))
				) {
					confirmed.current.set(current.id, current)
					entry.item = current
					entry.sent = undefined
					if (entry.desired === current.checked) {
						finish(entry, current)
						return
					}
					// Rapid taps coalesce to one latest intent, using the confirmed version.
					reconcile = false
					retries = 0
					continue
				}
				if (reconcile && unchanged && retries < 1 && !document.hidden) {
					// An unchanged read cannot prove the uncertain request won't
					// commit later. Confirm that same request before applying a
					// reversed intent, even when the latest tap matches this read.
					retries++
					reconcile = false
					continue
				}
				if (unchanged && reconcile) throw new Error('Retry limit reached')
				finish(
					entry,
					current,
					'This item changed. Check its current amount before checking again.',
				)
				return
			}
		} catch {
			if (stillActive(entry)) entry.status = 'failed'
		} finally {
			entry.running = false
			if (stillActive(entry)) redraw()
		}
	}

	const items = !sameList
		? serverItems
		: serverItems.flatMap((item) => {
				const entry = pending.current.get(item.id)
				const current =
					entry?.item ??
					(confirmed.current.has(item.id)
						? confirmed.current.get(item.id)
						: item)
				return current
					? [{ ...current, checked: entry?.desired ?? current.checked }]
					: []
			})
	for (const entry of pending.current.values()) {
		if (!sameList) break
		if (!items.some((item) => item.id === entry.item.id))
			items.push({ ...entry.item, checked: entry.desired })
	}
	// Keep the existing unchecked/checked ordering after a local confirmation,
	// without moving a row merely because its unconfirmed check was tapped.
	if (sameList)
		items.sort(
			(a, b) =>
				Number(pending.current.get(a.id)?.item.checked ?? a.checked) -
					Number(pending.current.get(b.id)?.item.checked ?? b.checked) ||
				a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
		)

	return {
		items,
		pendingIds: sameList ? [...pending.current.keys()] : [],
		notices: sameList ? [...notices.current.values()] : [],
		state: (id: string) =>
			sameList ? pending.current.get(id)?.status : undefined,
		toggle(item: Item) {
			if (item.id.startsWith('optimistic:')) return
			notices.current.delete(item.id)
			let entry = pending.current.get(item.id)
			if (entry) entry.desired = !entry.desired
			else {
				entry = {
					item,
					desired: !item.checked,
					status: 'saving',
					running: false,
				}
				pending.current.set(item.id, entry)
			}
			void run(entry, entry.status === 'failed')
			redraw()
		},
		retry(id: string) {
			const entry = pending.current.get(id)
			if (entry) void run(entry, true)
		},
	}
}
