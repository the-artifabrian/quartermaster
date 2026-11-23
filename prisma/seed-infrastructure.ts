import { prisma } from '#app/utils/db.server.ts'

/**
 * Seeds the `admin` and `user` roles, which must exist in every environment.
 * Idempotent, so it is safe to run on every deploy.
 *
 * Separated from the main seed so it can run in production (via litefs.yml)
 * without creating test users.
 */
export async function seedInfrastructure() {
	console.time('Created roles')
	await prisma.role.upsert({
		where: { name: 'admin' },
		update: {},
		create: { name: 'admin' },
	})
	await prisma.role.upsert({
		where: { name: 'user' },
		update: {},
		create: { name: 'user' },
	})
	console.timeEnd('Created roles')
}
