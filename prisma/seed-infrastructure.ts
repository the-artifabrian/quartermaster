import { prisma } from '#app/utils/db.server.ts'

/**
 * Seeds infrastructure data (permissions, roles, tags) that must exist in
 * every environment. Idempotent — safe to run on every deploy.
 *
 * Separated from the main seed so it can run in production (via litefs.yml)
 * without creating test users.
 */
export async function seedInfrastructure() {
	// Create permissions
	console.time('Created permissions')
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
	console.timeEnd('Created permissions')

	// Create predefined tags
	console.time('Created tags')
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
	console.timeEnd('Created tags')

	// Create roles
	console.time('Created roles')
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
	console.timeEnd('Created roles')
}
