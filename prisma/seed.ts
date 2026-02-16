import { prisma } from '#app/utils/db.server.ts'
import { MOCK_CODE_GITHUB } from '#app/utils/providers/constants.ts'
import { createPassword, getUserImages } from '#tests/db-utils.ts'
import { insertGitHubUser } from '#tests/mocks/github.ts'
import { seedInfrastructure } from './seed-infrastructure.ts'

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	// Infrastructure: permissions, roles, tags (shared with production)
	await seedInfrastructure()

	// Test data below — only runs via `prisma db seed` in development

	const userImages = await getUserImages()

	console.time(`🐨 Find or create admin user "kody"`)

	// Find or create kody user
	let kody = await prisma.user.findUnique({
		where: { username: 'kody' },
		select: { id: true },
	})

	if (!kody) {
		const githubUser = await insertGitHubUser(MOCK_CODE_GITHUB)

		kody = await prisma.user.create({
			select: { id: true },
			data: {
				email: 'kody@kcd.dev',
				username: 'kody',
				name: 'Kody',
				password: { create: createPassword('kodylovesyou') },
				connections: {
					create: {
						providerName: 'github',
						providerId: String(githubUser.profile.id),
					},
				},
				roles: { connect: [{ name: 'admin' }, { name: 'user' }] },
			},
		})

		const kodyImage = userImages[0]
		if (kodyImage) {
			await prisma.userImage.create({
				data: {
					userId: kody.id,
					objectKey: kodyImage.objectKey,
				},
			})
		}
	}

	console.timeEnd(`🐨 Find or create admin user "kody"`)

	// Ensure kody has a household
	console.time(`🏠 Ensure household for kody`)
	const existingMember = await prisma.householdMember.findFirst({
		where: { userId: kody.id },
	})
	if (!existingMember) {
		await prisma.household.create({
			data: {
				name: "Kody's Household",
				members: {
					create: { userId: kody.id, role: 'owner' },
				},
			},
		})
	}
	console.timeEnd(`🏠 Ensure household for kody`)

	// Create kody2 test user for household sharing testing
	console.time(`🐨 Find or create test user "kody2"`)

	let kody2 = await prisma.user.findUnique({
		where: { username: 'kody2' },
		select: { id: true },
	})

	if (!kody2) {
		kody2 = await prisma.user.create({
			select: { id: true },
			data: {
				email: 'kody2@kcd.dev',
				username: 'kody2',
				name: 'Kody Jr',
				password: { create: createPassword('kodylovesyou') },
				roles: { connect: [{ name: 'user' }] },
			},
		})
	}

	// Ensure kody2 has a household
	const kody2Member = await prisma.householdMember.findFirst({
		where: { userId: kody2.id },
	})
	if (!kody2Member) {
		await prisma.household.create({
			data: {
				name: "Kody Jr's Household",
				members: {
					create: { userId: kody2.id, role: 'owner' },
				},
			},
		})
	}

	console.timeEnd(`🐨 Find or create test user "kody2"`)

	// Ensure all users have Subscription records (Pro for test users)
	console.time(`💎 Ensure subscriptions`)
	for (const user of [kody, kody2]) {
		await prisma.subscription.upsert({
			where: { userId: user.id },
			update: {},
			create: { userId: user.id, tier: 'pro' },
		})
	}
	console.timeEnd(`💎 Ensure subscriptions`)

	console.timeEnd(`🌱 Database has been seeded`)
}

seed()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})

// we're ok to import from the test directory in this file
/*
eslint
	no-restricted-imports: "off",
*/
