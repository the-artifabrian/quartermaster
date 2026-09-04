/**
 * @vitest-environment jsdom
 */
import { expect, test } from 'vitest'
import {
	markPendingPwaUpdateActivated,
	PWA_UPDATE_COMPLETION_TTL_MS,
	PWA_UPDATE_STORAGE_KEY,
	rememberPendingPwaUpdate,
	takeCompletedPwaUpdate,
} from './pwa-update-telemetry.ts'

test('reports an accepted update only after activation survives the reload', () => {
	sessionStorage.clear()
	rememberPendingPwaUpdate({ fromBuild: 'old-build', acceptedAt: 1_000 })
	expect(
		takeCompletedPwaUpdate({ toBuild: 'new-build', completedAt: 1_100 }),
	).toBeNull()

	markPendingPwaUpdateActivated(1_200)
	expect(
		takeCompletedPwaUpdate({ toBuild: 'new-build', completedAt: 1_350 }),
	).toEqual({
		from_build: 'old-build',
		to_build: 'new-build',
		build_changed: true,
		accepted_to_activated_ms: 200,
		accepted_to_completed_ms: 350,
	})
	expect(sessionStorage.getItem(PWA_UPDATE_STORAGE_KEY)).toBeNull()
})

test('expires an abandoned update instead of reporting a later reload', () => {
	sessionStorage.clear()
	rememberPendingPwaUpdate({ fromBuild: 'old-build', acceptedAt: 1_000 })
	markPendingPwaUpdateActivated(1_200)

	expect(
		takeCompletedPwaUpdate({
			toBuild: 'new-build',
			completedAt: 1_000 + PWA_UPDATE_COMPLETION_TTL_MS + 1,
		}),
	).toBeNull()
	expect(sessionStorage.getItem(PWA_UPDATE_STORAGE_KEY)).toBeNull()
})
