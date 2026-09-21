import { invariantResponse } from '@epic-web/invariant'
import { createId } from '@paralleldrive/cuid2'
import { type Prisma } from '#app/generated/prisma/client.ts'
import { prisma } from './db.server.ts'
import { menuTitleKey } from './menu-validation.ts'
import { ensureRecipeMetadataValues } from './recipe-metadata.server.ts'
import { copyRecipeImage, deleteRecipeImage } from './storage.server.ts'

export const sharedRecipeSelect = {
	id: true,
	title: true,
	description: true,
	activeTime: true,
	totalTime: true,
	yieldAmount: true,
	yieldLabel: true,
	sourceUrl: true,
	user: { select: { name: true } },
	image: { select: { objectKey: true, altText: true } },
	ingredients: {
		select: {
			id: true,
			name: true,
			amount: true,
			unit: true,
			notes: true,
			isHeading: true,
		},
		orderBy: { order: 'asc' },
	},
	instructions: {
		select: { id: true, content: true },
		orderBy: { order: 'asc' },
	},
} satisfies Prisma.RecipeSelect

export type SharedRecipe = Prisma.RecipeGetPayload<{
	select: typeof sharedRecipeSelect
}>

export async function findSavedMenu(
	householdId: string,
	menuId: string,
	db: Pick<Prisma.TransactionClient, 'menu'> = prisma,
) {
	return (
		(await db.menu.findUnique({
			where: { id: menuId, householdId },
			select: { id: true },
		})) ??
		db.menu.findUnique({
			where: {
				householdId_copiedFromMenuId: { householdId, copiedFromMenuId: menuId },
			},
			select: { id: true },
		})
	)
}

/** One independent bundle. Network work finishes before taking the write lock. */
export async function saveSharedMenu({
	menuId,
	householdId,
	userId,
}: {
	menuId: string
	householdId: string
	userId: string
}) {
	const existing = await findSavedMenu(householdId, menuId)
	if (existing) return existing.id

	// Read one consistent source revision, including recoverable source text
	// server-side only. Personal Recipe notes are never copied.
	const menu = await prisma.$transaction((tx) =>
		tx.menu.findUnique({
			where: { id: menuId },
			include: {
				sections: {
					orderBy: { order: 'asc' },
					include: {
						items: {
							orderBy: { order: 'asc' },
							include: {
								shoppingLines: { orderBy: { order: 'asc' } },
								recipe: {
									include: {
										ingredients: true,
										instructions: true,
										image: true,
										metadataAssignments: { include: { value: true } },
									},
								},
							},
						},
					},
				},
			},
		}),
	)
	invariantResponse(menu, 'Menu not found', { status: 404 })
	const items = menu.sections.flatMap((section) => section.items)
	invariantResponse(
		items.every(
			(item) =>
				item.kind === 'note' ||
				(item.recipe && item.recipe.householdId === menu.householdId),
		),
		'This Menu has an unavailable Recipe. Ask its owner to replace or remove it before saving.',
		{ status: 409 },
	)
	const recipes = [
		...new Map(
			items.flatMap((item) =>
				item.kind === 'recipe' && item.recipe
					? [[item.recipe.id, item.recipe] as const]
					: [],
			),
		).values(),
	]
	const recipeIds = new Map(recipes.map((recipe) => [recipe.id, createId()]))
	const ingredientIds = new Map(
		recipes.flatMap((recipe) =>
			recipe.ingredients.map(
				(ingredient) => [ingredient.id, createId()] as const,
			),
		),
	)
	const imageKeys = new Map<string, string>()
	let committed = false
	try {
		for (const recipe of recipes) {
			if (recipe.image)
				imageKeys.set(
					recipe.id,
					await copyRecipeImage(
						recipe.image.objectKey,
						userId,
						recipeIds.get(recipe.id)!,
					),
				)
		}
		const result = await prisma.$transaction(async (tx) => {
			// Concurrent Save requests serialize here; the unique key is the
			// durable backstop. A repeat never refreshes the recipient's edits.
			const member = await tx.householdMember.findUnique({
				where: { householdId_userId: { householdId, userId } },
				select: { userId: true },
			})
			invariantResponse(
				member,
				'Your household changed. Reload this Menu and try again.',
				{ status: 403 },
			)
			const saved = await findSavedMenu(householdId, menuId, tx)
			if (saved) return { id: saved.id, created: false }
			const titles = await tx.menu.findMany({
				where: { householdId },
				select: { titleKey: true },
			})
			const taken = new Set(titles.map((value) => value.titleKey))
			let title = menu.title
			for (let n = 2; taken.has(menuTitleKey(title)); n++) {
				const suffix = ` (${n})`
				title = `${menu.title.slice(0, 100 - suffix.length)}${suffix}`
			}
			for (const recipe of recipes) {
				const metadataValueIds = await ensureRecipeMetadataValues(
					tx,
					householdId,
					recipe.metadataAssignments
						.filter((a) => a.value.householdId === menu.householdId)
						.map((a) => a.value),
				)
				await tx.recipe.create({
					data: {
						id: recipeIds.get(recipe.id)!,
						title: recipe.title,
						description: recipe.description,
						activeTime: recipe.activeTime,
						totalTime: recipe.totalTime,
						yieldAmount: recipe.yieldAmount,
						yieldLabel: recipe.yieldLabel,
						sourceUrl: recipe.sourceUrl,
						rawText: recipe.rawText,
						userId,
						householdId,
						metadataAssignments: {
							create: metadataValueIds.map((valueId) => ({ valueId })),
						},
						ingredients: {
							create: recipe.ingredients.map((ing) => ({
								id: ingredientIds.get(ing.id)!,
								name: ing.name,
								amount: ing.amount,
								unit: ing.unit,
								notes: ing.notes,
								isHeading: ing.isHeading,
								order: ing.order,
							})),
						},
						instructions: {
							create: recipe.instructions.map((step) => ({
								content: step.content,
								order: step.order,
							})),
						},
						...(recipe.image
							? {
									image: {
										create: {
											objectKey: imageKeys.get(recipe.id)!,
											altText: recipe.image.altText,
										},
									},
								}
							: {}),
					},
				})
			}
			// Retain ingredient links only when both Recipes belong to this bundle.
			for (const recipe of recipes) {
				for (const ing of recipe.ingredients) {
					const linkedRecipeId =
						ing.linkedRecipeId && recipeIds.get(ing.linkedRecipeId)
					if (linkedRecipeId)
						await tx.ingredient.update({
							where: { id: ingredientIds.get(ing.id)! },
							data: { linkedRecipeId },
						})
				}
			}
			const copy = await tx.menu.create({
				data: {
					title,
					titleKey: menuTitleKey(title),
					description: menu.description,
					defaultGuestCount: menu.defaultGuestCount,
					copiedFromMenuId: menu.id,
					householdId,
					sections: {
						create: menu.sections.map((section) => ({
							name: section.name,
							order: section.order,
							items: {
								create: section.items.map((item) => ({
									kind: item.kind,
									order: item.order,
									note: item.note,
									recipeId:
										item.kind === 'recipe'
											? recipeIds.get(item.recipeId!)!
											: null,
									recipeTitle: item.recipe?.title ?? item.recipeTitle,
									scaleMultiplier: item.scaleMultiplier,
									shoppingLines: {
										create: item.shoppingLines.map((line) => ({
											name: line.name,
											quantity: line.quantity,
											unit: line.unit,
											order: line.order,
										})),
									},
								})),
							},
						})),
					},
				},
				select: { id: true },
			})
			return { id: copy.id, created: true }
		})
		committed = result.created
		return result.id
	} finally {
		// Also clean up staged images when another request saved first. Check
		// references after commit, so cleanup never removes a successful copy.
		if (!committed)
			for (const objectKey of imageKeys.values()) {
				const used = await prisma.recipeImage.count({ where: { objectKey } })
				if (!used) await deleteRecipeImage(objectKey).catch(() => {})
			}
	}
}
