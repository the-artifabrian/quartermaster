/**
 * Fails the boot before anything mutates state when the environment is
 * invalid. Runs first in the `other/litefs.yml` exec chain — the app's own
 * `init()` (entry.server.tsx) would catch the same problems, but only after
 * `prisma migrate deploy` and the seed have already touched the schema, and
 * with `auto_rollback = false` (fly.toml) there is no automatic way back from
 * a machine that migrated and then refused to serve.
 */
import { init } from '#app/utils/env.server.ts'

init()
console.log('✅ Environment variables validated')
