/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest'
import {
	getPwaUpdateTelemetry,
	markPendingPwaUpdateActivated,
	PWA_UPDATE_COMPLETION_TTL_MS,
	PWA_UPDATE_STORAGE_KEY,
	rememberPendingPwaUpdate,
	rememberPwaUpdatePrompt,
} from './pwa-update-telemetry.ts'

const PROMPT_UUID = '00000000-0000-4000-8000-000000000001'
const ACCEPTED_UUID = '00000000-0000-4000-8000-000000000002'
const COMPLETED_UUID = '00000000-0000-4000-8000-000000000003'

test('persists stable update lifecycle events until PostHog can replay them', () => {
	sessionStorage.clear()
	expect(
		rememberPwaUpdatePrompt({
			workerState: 'installed',
			shownAt: 900,
			eventUuid: PROMPT_UUID,
		}),
	).toEqual({
		uuid: PROMPT_UUID,
		timestamp: 900,
		properties: { worker_state: 'installed' },
	})
	expect(
		rememberPendingPwaUpdate({
			fromBuild: 'old-build',
			acceptedAt: 1_000,
			eventUuid: ACCEPTED_UUID,
		}),
	).toEqual({
		uuid: ACCEPTED_UUID,
		timestamp: 1_000,
		properties: {
			from_build: 'old-build',
			prompt_to_accepted_ms: 100,
		},
	})

	expect(
		getPwaUpdateTelemetry({
			toBuild: 'new-build',
			completedAt: 1_100,
			completionEventUuid: COMPLETED_UUID,
		}),
	).toMatchObject({
		prompt: { uuid: PROMPT_UUID },
		accepted: { uuid: ACCEPTED_UUID },
	})
	expect(
		getPwaUpdateTelemetry({
			toBuild: 'new-build',
			completedAt: 1_100,
			completionEventUuid: COMPLETED_UUID,
		}).completed,
	).toBeUndefined()

	markPendingPwaUpdateActivated(1_200)
	const telemetry = getPwaUpdateTelemetry({
		toBuild: 'new-build',
		completedAt: 1_350,
		completionEventUuid: COMPLETED_UUID,
	})
	expect(telemetry).toEqual({
		prompt: {
			uuid: PROMPT_UUID,
			timestamp: 900,
			properties: { worker_state: 'installed' },
		},
		accepted: {
			uuid: ACCEPTED_UUID,
			timestamp: 1_000,
			properties: {
				from_build: 'old-build',
				prompt_to_accepted_ms: 100,
			},
		},
		completed: {
			uuid: COMPLETED_UUID,
			timestamp: 1_350,
			properties: {
				from_build: 'old-build',
				to_build: 'new-build',
				build_changed: true,
				accepted_to_activated_ms: 200,
				accepted_to_completed_ms: 350,
			},
		},
	})
	expect(sessionStorage.getItem(PWA_UPDATE_STORAGE_KEY)).not.toBeNull()

	// A second document reuses the same event UUIDs and completion timestamp,
	// allowing PostHog to deduplicate the replay.
	expect(
		getPwaUpdateTelemetry({
			toBuild: 'ignored-later-build',
			completedAt: 1_400,
			completionEventUuid: '00000000-0000-4000-8000-000000000004',
		}),
	).toEqual(telemetry)
})

test('expires abandoned telemetry instead of replaying it indefinitely', () => {
	sessionStorage.clear()
	rememberPwaUpdatePrompt({
		workerState: 'installed',
		shownAt: 1_000,
		eventUuid: PROMPT_UUID,
	})

	expect(
		getPwaUpdateTelemetry({
			toBuild: 'new-build',
			completedAt: 1_000 + PWA_UPDATE_COMPLETION_TTL_MS + 1,
			completionEventUuid: COMPLETED_UUID,
		}),
	).toEqual({})
	expect(sessionStorage.getItem(PWA_UPDATE_STORAGE_KEY)).toBeNull()
})

test('generated event IDs are valid UUIDs for PostHog deduplication', () => {
	sessionStorage.clear()
	const capture = rememberPwaUpdatePrompt({ workerState: 'installed' })
	expect(capture.uuid).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	)
})
