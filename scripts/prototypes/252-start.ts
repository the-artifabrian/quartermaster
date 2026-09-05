// Disposable only. One command: bun scripts/prototypes/252-start.ts
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { dishes, notes } from './252-fixtures.ts'
const scratch = '/private/tmp/qm-252-review'
await mkdir(scratch, { recursive: true })
process.env.DATABASE_URL = `file:${scratch}/data.db`
process.env.DATABASE_PATH = `${scratch}/data.db`
process.env.DATA_VOLUME_PATH = scratch
process.env.PORT = '9252'
process.env.MOCKS = 'true'
process.env.NODE_ENV = 'development'
for (const args of [
	['prisma', 'generate'],
	['prisma', 'migrate', 'deploy'],
]) {
	const [code] = await once(
		spawn('bunx', args, { stdio: 'inherit', env: process.env }),
		'exit',
	)
	if (code) process.exit(code)
}
const { prisma } = await import('../../app/utils/db.server.ts')
const { getPasswordHash } = await import('../../app/utils/auth.server.ts')
const { createMealWithItems } = await import('../../app/utils/meal.server.ts')
const { menuToSnapshotSections } =
	await import('../../app/utils/menu-snapshot.ts')
if (!(await prisma.user.findUnique({ where: { username: 'review252' } }))) {
	if (await prisma.user.count())
		throw new Error(
			'Scratch database is not empty; choose a fresh scratch directory',
		)
	const user = await prisma.user.create({
		data: {
			username: 'review252',
			email: 'review252@example.test',
			name: 'Review comparison',
			password: { create: { hash: await getPasswordHash('local-review-252') } },
			subscription: { create: { tier: 'pro' } },
		},
	})
	const household = await prisma.household.create({
		data: {
			name: 'Disposable Saturday supper',
			staplesCutoverAt: new Date(),
			members: { create: { userId: user.id, role: 'owner' } },
			householdIngredients: {
				create: [
					{
						displayName: 'olive oil',
						canonicalKey: 'olive oil',
						isStaple: true,
					},
					{
						displayName: 'garlic',
						canonicalKey: 'garlic',
						isStaple: true,
						isOut: true,
					},
				],
			},
		},
	})
	const recipes = []
	for (const dish of dishes)
		recipes.push(
			await prisma.recipe.create({
				data: {
					title: dish.title,
					householdId: household.id,
					userId: user.id,
					ingredients: {
						create: dish.lines.map((l, order) => ({
							name: l.name,
							amount: l.amount == null ? null : String(l.amount),
							unit: l.unit,
							order,
						})),
					},
					instructions: {
						create: {
							content: 'Prepare and serve with the other dishes.',
							order: 0,
						},
					},
				},
			}),
		)
	const menu = await prisma.menu.create({
		data: {
			title: 'Saturday supper',
			titleKey: 'saturday supper',
			householdId: household.id,
			sections: {
				create: {
					name: null,
					order: 0,
					items: {
						create: [
							...recipes.map((r, i) => ({
								kind: 'recipe',
								order: i,
								recipeId: r.id,
								recipeTitle: r.title,
								scaleMultiplier: dishes[i]!.scale,
							})),
							{
								kind: 'note',
								order: 4,
								note: 'Serve cold',
								shoppingLines: {
									create: notes.map((l, order) => ({
										name: l.name,
										quantity: l.amount == null ? null : String(l.amount),
										unit: l.unit,
										order,
									})),
								},
							},
						],
					},
				},
			},
		},
		include: {
			sections: {
				include: { items: { include: { recipe: true, shoppingLines: true } } },
			},
		},
	})
	const today = new Date()
	const monday = new Date(
		Date.UTC(
			today.getFullYear(),
			today.getMonth(),
			today.getDate() - ((today.getDay() + 6) % 7),
		),
	)
	const saturday = new Date(monday)
	saturday.setUTCDate(saturday.getUTCDate() + 5)
	const plan = await prisma.mealPlan.create({
		data: { householdId: household.id, weekStart: monday },
	})
	await createMealWithItems(prisma, {
		mealPlanId: plan.id,
		date: saturday,
		label: 'Saturday supper',
		sourceMenuId: menu.id,
		sourceMenuRevision: menu.updatedAt,
		items: [],
		sections: menuToSnapshotSections(menu, household.id),
	})
	await prisma.shoppingList.create({
		data: {
			userId: user.id,
			householdId: household.id,
			items: {
				create: [
					{ name: 'milk', quantity: '1', unit: 'l', source: 'manual' },
					{
						name: 'garlic',
						quantity: '2',
						unit: 'cloves',
						source: 'manual',
						checked: true,
					},
				],
			},
		},
	})
}
await prisma.$disconnect()
console.log(
	'Open http://localhost:9252/recipes/menus/prototype-review?variant=B — review252 / local-review-252',
)
const server = spawn('bun', ['run', 'dev'], {
	stdio: 'inherit',
	env: process.env,
})
process.on('SIGINT', () => server.kill())
process.on('SIGTERM', () => server.kill())
const [code] = await once(server, 'exit')
process.exit(code ?? 0)
