import { prisma } from '#app/utils/db.server.ts'
import { MOCK_CODE_GITHUB } from '#app/utils/providers/constants.ts'
import { createPassword, getUserImages } from '#tests/db-utils.ts'
import { insertGitHubUser } from '#tests/mocks/github.ts'

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	// Create permissions
	console.time(`🔑 Created permissions...`)
	const entities = ['user'] as const
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

	console.time(`🐨 Created admin user "kody"`)

	const githubUser = await insertGitHubUser(MOCK_CODE_GITHUB)

	const kody = await prisma.user.create({
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

	console.timeEnd(`🐨 Created admin user "kody"`)

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
