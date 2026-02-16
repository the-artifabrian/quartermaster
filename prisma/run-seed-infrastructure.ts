import { prisma } from '#app/utils/db.server.ts'
import { seedInfrastructure } from './seed-infrastructure.ts'

seedInfrastructure()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
