import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { groupSnapshotEntries } from '#app/utils/menu-snapshot.ts'
import { type Route } from './+types/export-all-data.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

	const [user, recipes, inventory, mealPlans, shoppingLists, menus] =
		await Promise.all([
			prisma.user.findUniqueOrThrow({
				where: { id: userId },
				select: { username: true, email: true, name: true },
			}),
			prisma.recipe.findMany({
				where: { householdId },
				select: {
					id: true,
					title: true,
					description: true,
					activeTime: true,
					totalTime: true,
					yieldAmount: true,
					yieldLabel: true,
					isFavorite: true,
					isAiGenerated: true,
					sourceUrl: true,
					notes: true,
					ingredients: {
						select: { name: true, amount: true, unit: true, notes: true },
						orderBy: { order: 'asc' },
					},
					instructions: {
						select: { content: true },
						orderBy: { order: 'asc' },
					},
					image: { select: { objectKey: true, altText: true } },
					metadataAssignments: {
						select: {
							value: {
								select: {
									dimension: true,
									name: true,
									nameKey: true,
									sortOrder: true,
								},
							},
						},
						orderBy: { valueId: 'asc' },
					},
				},
				orderBy: { title: 'asc' },
			}),
			prisma.inventoryItem.findMany({
				where: { householdId },
				select: {
					name: true,
				},
				orderBy: [{ name: 'asc' }],
			}),
			prisma.mealPlan.findMany({
				where: { householdId },
				select: {
					weekStart: true,
					meals: {
						select: {
							id: true,
							date: true,
							order: true,
							label: true,
							servingAt: true,
							servingTimeZone: true,
							genericText: true,
							completed: true,
							guestCount: true,
							sourceMenu: { select: { title: true } },
							sourceMenuRevision: true,
							sections: {
								orderBy: { order: 'asc' },
								select: { id: true, name: true },
							},
							noteItems: {
								orderBy: { order: 'asc' },
								select: {
									text: true,
									order: true,
									sectionId: true,
									shoppingLines: {
										orderBy: { order: 'asc' },
										select: { name: true, quantity: true, unit: true },
									},
								},
							},
							recipeItems: {
								select: {
									recipeId: true,
									recipeTitle: true,
									scaleMultiplier: true,
									cooked: true,
									note: true,
									order: true,
									sectionId: true,
								},
								orderBy: { order: 'asc' },
							},
						},
						orderBy: [{ date: 'asc' }, { order: 'asc' }],
					},
				},
				orderBy: { weekStart: 'desc' },
			}),
			prisma.shoppingList.findMany({
				where: { householdId },
				select: {
					name: true,
					items: {
						select: {
							id: true,
							name: true,
							quantity: true,
							unit: true,
							category: true,
							checked: true,
							source: true,
							horizon: true,
							mealContributions: {
								orderBy: [{ canonicalName: 'asc' }, { id: 'asc' }],
								select: {
									mealId: true,
									canonicalName: true,
									name: true,
									quantity: true,
									unit: true,
								},
							},
						},
						orderBy: { name: 'asc' },
					},
				},
				orderBy: { updatedAt: 'desc' },
			}),
			prisma.menu.findMany({
				where: { householdId },
				select: {
					title: true,
					description: true,
					defaultGuestCount: true,
					sections: {
						orderBy: { order: 'asc' },
						select: {
							name: true,
							items: {
								orderBy: { order: 'asc' },
								select: {
									kind: true,
									recipeId: true,
									recipeTitle: true,
									scaleMultiplier: true,
									note: true,
									shoppingLines: {
										orderBy: { order: 'asc' },
										select: { name: true, quantity: true, unit: true },
									},
								},
							},
						},
					},
				},
				orderBy: { title: 'asc' },
			}),
		])
	const [household, householdIngredients, recipeMetadataValues] =
		await Promise.all([
			prisma.household.findUniqueOrThrow({
				where: { id: householdId },
				select: { staplesCutoverAt: true },
			}),
			prisma.householdIngredient.findMany({
				where: { householdId },
				select: {
					displayName: true,
					canonicalKey: true,
					isStaple: true,
					isOut: true,
				},
				orderBy: [{ canonicalKey: 'asc' }, { id: 'asc' }],
			}),
			prisma.recipeMetadataValue.findMany({
				where: { householdId },
				select: {
					dimension: true,
					name: true,
					nameKey: true,
					sortOrder: true,
				},
				orderBy: [{ dimension: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
			}),
		])

	// Export-local reference keys: import restores Menu Recipe references by
	// key, so renamed Recipes still reconnect; title fallback is for older
	// exports only (#102).
	const recipeRefById = new Map(
		recipes.map((recipe, index) => [recipe.id, `r${index + 1}`]),
	)
	const mealRefById = new Map(
		mealPlans
			.flatMap((plan) => plan.meals)
			.map((meal, index) => [meal.id, `m${index + 1}`]),
	)

	const exportData = {
		exportedAt: new Date().toISOString(),
		format: 'quartermaster-full-export-v1',
		user: {
			username: user.username,
			email: user.email,
			name: user.name,
		},
		household: {
			staplesCutoverAt: household.staplesCutoverAt?.toISOString() ?? null,
		},
		householdIngredients,
		recipeMetadataValues,
		recipes: recipes.map((recipe) => ({
			ref: recipeRefById.get(recipe.id)!,
			title: recipe.title,
			description: recipe.description,
			activeTime: recipe.activeTime,
			totalTime: recipe.totalTime,
			yieldAmount: recipe.yieldAmount,
			yieldLabel: recipe.yieldLabel,
			isFavorite: recipe.isFavorite,
			isAiGenerated: recipe.isAiGenerated,
			sourceUrl: recipe.sourceUrl,
			notes: recipe.notes,
			metadataValues: recipe.metadataAssignments.map(
				(assignment) => assignment.value,
			),
			ingredients: recipe.ingredients.map((ing) => ({
				name: ing.name,
				amount: ing.amount,
				unit: ing.unit,
				notes: ing.notes,
			})),
			instructions: recipe.instructions.map((inst) => inst.content),
			image: recipe.image
				? {
						url: `/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}`,
						altText: recipe.image.altText,
					}
				: null,
		})),
		inventory: inventory.map((item) => ({
			name: item.name,
		})),
		mealPlans: mealPlans.map((plan) => ({
			weekStart: plan.weekStart.toISOString(),
			// Meals are the Plan's durable recovery data (#104, sole representation
			// since #106): within-day order, serving instant/timezone, generic
			// text, text-only completion, guest count, source Menu
			// identity/revision, and each ordered Recipe item's frozen identity,
			// multiplier, display note, and cooked state. Since #107 a Meal may be
			// a Menu snapshot: `sections` carries its frozen section structure with
			// Recipe and note cards interleaved in their shared order, plus each
			// note's ordinary Shopping lines; `items` stays the unsectioned list.
			// Missing cards export a null recipeRef with their frozen title, like
			// Menu cards do.
			meals: plan.meals.map((meal) => {
				const recipeEntry = (item: {
					recipeId: string | null
					recipeTitle: string
					scaleMultiplier: number
					cooked: boolean
					note: string | null
				}) => ({
					kind: 'recipe' as const,
					recipeRef:
						(item.recipeId && recipeRefById.get(item.recipeId)) || null,
					recipeTitle: item.recipeTitle,
					scaleMultiplier: item.scaleMultiplier,
					note: item.note,
					cooked: item.cooked,
				})
				const noteEntry = (note: {
					text: string
					shoppingLines: Array<{
						name: string
						quantity: string | null
						unit: string | null
					}>
				}) => ({
					kind: 'note' as const,
					text: note.text,
					shoppingLines: note.shoppingLines.map((line) => ({
						name: line.name,
						quantity: line.quantity,
						unit: line.unit,
					})),
				})
				return {
					ref: mealRefById.get(meal.id)!,
					date: meal.date.toISOString(),
					order: meal.order,
					label: meal.label,
					servingAt: meal.servingAt?.toISOString() ?? null,
					servingTimeZone: meal.servingTimeZone,
					genericText: meal.genericText,
					completed: meal.completed,
					guestCount: meal.guestCount,
					// Menus have no export-local refs — normalized household title is
					// their identity, so import reconnects by title.
					sourceMenuTitle: meal.sourceMenu?.title ?? null,
					sourceMenuRevision: meal.sourceMenuRevision?.toISOString() ?? null,
					// Note cards live only inside frozen sections — `items` is the
					// unsectioned Recipe list (planner-created and later additions).
					items: meal.recipeItems
						.filter((item) => item.sectionId == null)
						.map(recipeEntry),
					sections: groupSnapshotEntries(
						meal.sections,
						meal.recipeItems,
						meal.noteItems,
					).map((group) => ({
						name: group.name,
						items: group.entries.map((entry) =>
							entry.kind === 'recipe'
								? recipeEntry(entry.item)
								: noteEntry(entry.item),
						),
					})),
				}
			}),
		})),
		shoppingLists: shoppingLists.map((list) => ({
			name: list.name,
			items: list.items.map((item) => ({
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				category: item.category,
				checked: item.checked,
				source: item.source,
				horizon: item.horizon,
				// Nesting keeps every contribution attached to the exact exported
				// row whose checked state it shares. Meal refs are export-local;
				// null plus orphaned=true records safely kept post-deletion state.
				mealContributions: item.mealContributions.map((contribution) => ({
					sourceMealRef:
						(contribution.mealId && mealRefById.get(contribution.mealId)) ??
						null,
					orphaned: contribution.mealId == null,
					fingerprint: {
						canonicalName: contribution.canonicalName,
						name: contribution.name,
						quantity: contribution.quantity,
						unit: contribution.unit,
					},
				})),
			})),
		})),
		// Menus are durable recovery data: sections, Recipe/note cards, scale
		// multipliers, notes, ordering, and note Shopping lines — never
		// transient UI state (#102). Missing cards export a null recipeRef with
		// their frozen title.
		menus: menus.map((menu) => ({
			title: menu.title,
			description: menu.description,
			defaultGuestCount: menu.defaultGuestCount,
			sections: menu.sections.map((section) => ({
				name: section.name,
				items: section.items.map((item) =>
					item.kind === 'note'
						? {
								kind: 'note' as const,
								text: item.note,
								shoppingLines: item.shoppingLines.map((line) => ({
									name: line.name,
									quantity: line.quantity,
									unit: line.unit,
								})),
							}
						: {
								kind: 'recipe' as const,
								recipeRef:
									(item.recipeId && recipeRefById.get(item.recipeId)) || null,
								recipeTitle: item.recipeTitle,
								scaleMultiplier: item.scaleMultiplier,
								note: item.note,
							},
				),
			})),
		})),
	}

	const date = new Date().toISOString().split('T')[0]

	return new Response(JSON.stringify(exportData, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="quartermaster-export-${date}.json"`,
		},
	})
}
