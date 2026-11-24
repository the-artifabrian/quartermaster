import { todayInTimeZone } from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { assertLocalDatabase, seedDevelopment } from './seed-development.ts'
import { seedInfrastructure } from './seed-infrastructure.ts'

/**
 * `prisma db seed`: the roles every environment needs, then the local logins
 * and the sample Household (seed-development.ts). Development only.
 */
async function seed() {
	// Before any write, roles included.
	assertLocalDatabase()
	// The demo template uploads its photos. The dev server runs with
	// MOCKS=true, which keeps uploads in tests/fixtures/uploaded, so the seed
	// puts them there too.
	await import('#tests/mocks/index.ts')
	console.time('Seeded the database')
	await seedInfrastructure()

	// The browser's today, which on this machine is the machine's own day, so
	// the Plan opens on the week that was seeded.
	const today = todayInTimeZone(
		Intl.DateTimeFormat().resolvedOptions().timeZone,
	)
	console.time(`Seeded the sample Household for the week of ${today}`)
	await seedDevelopment(prisma, { today })
	console.timeEnd(`Seeded the sample Household for the week of ${today}`)

	console.timeEnd('Seeded the database')
}

seed()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
		// The mock server would keep the process open.
		process.exit()
	})
