/**
 * Import this from any test that talks to a third-party API:
 *
 * ```ts
 * import '#tests/setup/mocks-setup.ts'
 * ```
 *
 * It installs the MSW handlers for the file and resets per-test overrides
 * afterwards. Files without it fail fast on outbound requests instead of
 * loading MSW, which is the single most expensive piece of test setup.
 */

import { afterEach } from 'vitest'
import { server } from '#tests/mocks/index.ts'
import { MOCKS_INSTALLED } from './network-guard.ts'

Reflect.set(globalThis, MOCKS_INSTALLED, true)

afterEach(() => server.resetHandlers())

export { server }
