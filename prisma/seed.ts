import { prisma } from '#app/utils/db.server.ts'
import { MOCK_CODE_GITHUB } from '#app/utils/providers/constants.ts'
import { createPassword, getUserImages } from '#tests/db-utils.ts'
import { insertGitHubUser } from '#tests/mocks/github.ts'

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	// Create permissions
	console.time(`🔑 Created permissions...`)
	const entities = ['user', 'recipe'] as const
	const actions = ['create', 'read', 'update', 'delete'] as const
	const accesses = ['own', 'any'] as const

	for (const entity of entities) {
		for (const action of actions) {
			for (const access of accesses) {
				await prisma.permission.upsert({
					where: { action_entity_access: { entity, action, access } },
					update: {},
					create: { entity, action, access },
				})
			}
		}
	}
	console.timeEnd(`🔑 Created permissions...`)

	// Create predefined tags
	console.time(`🏷️ Created tags...`)
	const tags = [
		// Cuisine
		{ name: 'Italian', category: 'cuisine' },
		{ name: 'Mexican', category: 'cuisine' },
		{ name: 'Asian', category: 'cuisine' },
		{ name: 'American', category: 'cuisine' },
		{ name: 'Mediterranean', category: 'cuisine' },
		{ name: 'Indian', category: 'cuisine' },
		// Meal Type
		{ name: 'Breakfast', category: 'meal-type' },
		{ name: 'Lunch', category: 'meal-type' },
		{ name: 'Dinner', category: 'meal-type' },
		{ name: 'Snack', category: 'meal-type' },
		{ name: 'Dessert', category: 'meal-type' },
		// Dietary
		{ name: 'Vegetarian', category: 'dietary' },
		{ name: 'Vegan', category: 'dietary' },
		{ name: 'Gluten-Free', category: 'dietary' },
		{ name: 'Dairy-Free', category: 'dietary' },
		{ name: 'Keto', category: 'dietary' },
	]

	for (const tag of tags) {
		await prisma.tag.upsert({
			where: { name: tag.name },
			update: {},
			create: tag,
		})
	}
	console.timeEnd(`🏷️ Created tags...`)

	// Create roles
	console.time(`👑 Created roles...`)
	await prisma.role.upsert({
		where: { name: 'admin' },
		update: {},
		create: {
			name: 'admin',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: { access: 'any' },
				}),
			},
		},
	})

	await prisma.role.upsert({
		where: { name: 'user' },
		update: {},
		create: {
			name: 'user',
			permissions: {
				connect: await prisma.permission.findMany({
					select: { id: true },
					where: { access: 'own' },
				}),
			},
		},
	})
	console.timeEnd(`👑 Created roles...`)

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
