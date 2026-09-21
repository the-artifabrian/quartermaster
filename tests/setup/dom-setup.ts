import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Loaded automatically by `setup-test-env.ts` for files that declare
// `@vitest-environment jsdom`. Node-environment tests never pay for React DOM.
afterEach(() => cleanup())
