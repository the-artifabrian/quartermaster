export const PWA_UPDATE_STORAGE_KEY = 'qm:pwa-update'
export const PWA_UPDATE_COMPLETION_TTL_MS = 10 * 60 * 1000

type PendingPwaUpdate = {
	fromBuild: string
	acceptedAt: number
	activatedAt?: number
}

export type CompletedPwaUpdate = {
	from_build: string
	to_build: string
	build_changed: boolean
	accepted_to_activated_ms: number
	accepted_to_completed_ms: number
}

function getStorage() {
	if (typeof window === 'undefined') return null
	try {
		return window.sessionStorage
	} catch {
		return null
	}
}

function readPendingUpdate(): PendingPwaUpdate | null {
	const storage = getStorage()
	if (!storage) return null
	try {
		const value: unknown = JSON.parse(
			storage.getItem(PWA_UPDATE_STORAGE_KEY) ?? 'null',
		)
		if (
			!value ||
			typeof value !== 'object' ||
			!('fromBuild' in value) ||
			typeof value.fromBuild !== 'string' ||
			!('acceptedAt' in value) ||
			typeof value.acceptedAt !== 'number' ||
			('activatedAt' in value && typeof value.activatedAt !== 'number')
		) {
			return null
		}
		return value as PendingPwaUpdate
	} catch {
		return null
	}
}

function writePendingUpdate(update: PendingPwaUpdate) {
	try {
		getStorage()?.setItem(PWA_UPDATE_STORAGE_KEY, JSON.stringify(update))
	} catch {
		// Analytics must never interfere with accepting an app update.
	}
}

export function forgetPendingPwaUpdate() {
	try {
		getStorage()?.removeItem(PWA_UPDATE_STORAGE_KEY)
	} catch {
		// Analytics must never interfere with accepting an app update.
	}
}

export function rememberPendingPwaUpdate({
	fromBuild,
	acceptedAt = Date.now(),
}: {
	fromBuild: string
	acceptedAt?: number
}) {
	writePendingUpdate({ fromBuild, acceptedAt })
}

export function markPendingPwaUpdateActivated(activatedAt = Date.now()) {
	const pending = readPendingUpdate()
	if (!pending) return
	writePendingUpdate({ ...pending, activatedAt })
}

/** Consume an accepted-and-activated update after its reload has completed. */
export function takeCompletedPwaUpdate({
	toBuild,
	completedAt = Date.now(),
}: {
	toBuild: string
	completedAt?: number
}): CompletedPwaUpdate | null {
	const pending = readPendingUpdate()
	if (!pending) return null

	if (
		completedAt < pending.acceptedAt ||
		completedAt - pending.acceptedAt > PWA_UPDATE_COMPLETION_TTL_MS
	) {
		forgetPendingPwaUpdate()
		return null
	}

	if (pending.activatedAt == null) return null
	forgetPendingPwaUpdate()
	return {
		from_build: pending.fromBuild,
		to_build: toBuild,
		build_changed: pending.fromBuild !== toBuild,
		accepted_to_activated_ms: Math.max(
			0,
			pending.activatedAt - pending.acceptedAt,
		),
		accepted_to_completed_ms: Math.max(0, completedAt - pending.acceptedAt),
	}
}
