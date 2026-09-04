export const PWA_UPDATE_STORAGE_KEY = 'qm:pwa-update'
export const PWA_UPDATE_COMPLETION_TTL_MS = 10 * 60 * 1000

type StoredEvent = {
	uuid: string
	timestamp: number
}

type StoredPrompt = StoredEvent & {
	workerState: ServiceWorkerState
}

type StoredAcceptance = StoredEvent & {
	fromBuild: string
}

type StoredCompletion = StoredEvent & {
	toBuild: string
}

type PendingPwaUpdate = {
	version: 1
	prompt?: StoredPrompt
	accepted?: StoredAcceptance
	activatedAt?: number
	completed?: StoredCompletion
}

export type PwaTelemetryCapture = {
	uuid: string
	timestamp: number
	properties: Record<string, unknown>
}

export type PwaUpdateTelemetry = {
	prompt?: PwaTelemetryCapture
	accepted?: PwaTelemetryCapture
	completed?: PwaTelemetryCapture
}

function getStorage() {
	if (typeof window === 'undefined') return null
	try {
		return window.sessionStorage
	} catch {
		return null
	}
}

function isStoredEvent(value: unknown): value is StoredEvent {
	return (
		value != null &&
		typeof value === 'object' &&
		'uuid' in value &&
		typeof value.uuid === 'string' &&
		'timestamp' in value &&
		typeof value.timestamp === 'number'
	)
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
			!('version' in value) ||
			value.version !== 1
		) {
			return null
		}

		const pending = value as Partial<PendingPwaUpdate>
		if (
			(pending.prompt != null &&
				(!isStoredEvent(pending.prompt) ||
					typeof pending.prompt.workerState !== 'string')) ||
			(pending.accepted != null &&
				(!isStoredEvent(pending.accepted) ||
					typeof pending.accepted.fromBuild !== 'string')) ||
			(pending.activatedAt != null &&
				typeof pending.activatedAt !== 'number') ||
			(pending.completed != null &&
				(!isStoredEvent(pending.completed) ||
					typeof pending.completed.toBuild !== 'string'))
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

function createEventUuid() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID()
	}

	const bytes = new Uint8Array(16)
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		crypto.getRandomValues(bytes)
	} else {
		for (let index = 0; index < bytes.length; index += 1) {
			bytes[index] = Math.floor(Math.random() * 256)
		}
	}
	bytes[6] = (bytes[6]! & 0x0f) | 0x40
	bytes[8] = (bytes[8]! & 0x3f) | 0x80
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
	return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function toPromptCapture(prompt: StoredPrompt): PwaTelemetryCapture {
	return {
		uuid: prompt.uuid,
		timestamp: prompt.timestamp,
		properties: { worker_state: prompt.workerState },
	}
}

function toAcceptedCapture(
	accepted: StoredAcceptance,
	prompt?: StoredPrompt,
): PwaTelemetryCapture {
	return {
		uuid: accepted.uuid,
		timestamp: accepted.timestamp,
		properties: {
			from_build: accepted.fromBuild,
			...(prompt
				? {
						prompt_to_accepted_ms: Math.max(
							0,
							accepted.timestamp - prompt.timestamp,
						),
					}
				: {}),
		},
	}
}

export function rememberPwaUpdatePrompt({
	workerState,
	shownAt = Date.now(),
	eventUuid = createEventUuid(),
}: {
	workerState: ServiceWorkerState
	shownAt?: number
	eventUuid?: string
}): PwaTelemetryCapture {
	const prompt = { uuid: eventUuid, timestamp: shownAt, workerState }
	writePendingUpdate({ version: 1, prompt })
	return toPromptCapture(prompt)
}

export function rememberPendingPwaUpdate({
	fromBuild,
	acceptedAt = Date.now(),
	eventUuid = createEventUuid(),
}: {
	fromBuild: string
	acceptedAt?: number
	eventUuid?: string
}): PwaTelemetryCapture {
	const pending = readPendingUpdate() ?? { version: 1 }
	const accepted = { uuid: eventUuid, timestamp: acceptedAt, fromBuild }
	writePendingUpdate({ ...pending, accepted })
	return toAcceptedCapture(accepted, pending.prompt)
}

export function markPendingPwaUpdateActivated(activatedAt = Date.now()) {
	const pending = readPendingUpdate()
	if (!pending?.accepted) return
	writePendingUpdate({ ...pending, activatedAt })
}

/**
 * Replay the update lifecycle after a reload with stable event UUIDs. The
 * record intentionally remains for the short TTL: PostHog deduplicates a
 * repeated UUID if another reload happens before the deferred SDK can send.
 */
export function getPwaUpdateTelemetry({
	toBuild,
	completedAt = Date.now(),
	completionEventUuid = createEventUuid(),
}: {
	toBuild: string
	completedAt?: number
	completionEventUuid?: string
}): PwaUpdateTelemetry {
	const pending = readPendingUpdate()
	if (!pending) return {}

	const startedAt = pending.prompt?.timestamp ?? pending.accepted?.timestamp
	const latestAt =
		pending.completed?.timestamp ??
		pending.activatedAt ??
		pending.accepted?.timestamp ??
		pending.prompt?.timestamp
	if (
		startedAt == null ||
		latestAt == null ||
		completedAt < startedAt ||
		completedAt - latestAt > PWA_UPDATE_COMPLETION_TTL_MS
	) {
		forgetPendingPwaUpdate()
		return {}
	}

	let completed = pending.completed
	if (!completed && pending.accepted && pending.activatedAt != null) {
		completed = {
			uuid: completionEventUuid,
			timestamp: completedAt,
			toBuild,
		}
		writePendingUpdate({ ...pending, completed })
	}

	return {
		...(pending.prompt ? { prompt: toPromptCapture(pending.prompt) } : {}),
		...(pending.accepted
			? { accepted: toAcceptedCapture(pending.accepted, pending.prompt) }
			: {}),
		...(completed && pending.accepted && pending.activatedAt != null
			? {
					completed: {
						uuid: completed.uuid,
						timestamp: completed.timestamp,
						properties: {
							from_build: pending.accepted.fromBuild,
							to_build: completed.toBuild,
							build_changed: pending.accepted.fromBuild !== completed.toBuild,
							accepted_to_activated_ms: Math.max(
								0,
								pending.activatedAt - pending.accepted.timestamp,
							),
							accepted_to_completed_ms: Math.max(
								0,
								completed.timestamp - pending.accepted.timestamp,
							),
						},
					},
				}
			: {}),
	}
}
