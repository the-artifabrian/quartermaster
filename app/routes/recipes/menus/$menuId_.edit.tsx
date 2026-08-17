import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, useFetcher } from 'react-router'
import { MenuForm, type MenuBuilderItem } from '#app/components/menu-form.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	DUPLICATE_MENU_RECIPE_MESSAGE,
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuBuilderSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { type Route } from './+types/$menuId_.edit.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Edit Menu | Quartermaster' }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeId: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
						},
					},
				},
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const items: MenuBuilderItem[] = menu.sections
		.flatMap((section) => section.items)
		.filter((item) => item.kind === 'recipe')
		.map((item) => ({
			id: item.id,
			recipeId: item.recipeId,
			recipeTitle: item.recipeTitle ?? 'Recipe',
			scaleMultiplier: item.scaleMultiplier ?? 1,
			note: item.note,
		}))

	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		select: {
			id: true,
			title: true,
			prepTime: true,
			cookTime: true,
			isFavorite: true,
			image: { select: { objectKey: true } },
		},
		orderBy: { title: 'asc' },
	})

	return { menu, items, recipes }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					items: { select: { id: true, recipeId: true } },
				},
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	const formData = await request.formData()

	if (formData.get('intent') === 'delete') {
		await prisma.menu.delete({ where: { id: menuId } })
		return redirect('/recipes/menus')
	}

	const submission = parseWithZod(formData, { schema: MenuBuilderSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, description, defaultGuestCount } = submission.value
	const items = submission.value.items ?? []

	// The durable unnamed section (#99) — where 1A composition lives until #101
	// introduces custom sections.
	const unnamedSection = menu.sections[0]
	invariantResponse(unnamedSection, 'Menu has no section', { status: 500 })

	const storedItems = menu.sections.flatMap((section) => section.items)
	const storedById = new Map(storedItems.map((item) => [item.id, item]))

	// Submitted item ids must belong to this menu — reject forged ids outright.
	invariantResponse(
		items.every((item) => item.id == null || storedById.has(item.id)),
		'Invalid menu item',
		{ status: 400 },
	)

	// Effective Recipe references after this save: an existing item keeps its
	// stored reference unless the submission explicitly replaces it (a missing
	// card submits an empty recipeId, which never unlinks a live one).
	const effectiveRecipeIds = items.map((item) => {
		if (item.id != null) {
			const stored = storedById.get(item.id)!
			return item.recipeId != null && item.recipeId !== stored.recipeId
				? item.recipeId
				: stored.recipeId
		}
		return item.recipeId ?? null
	})

	const linkedIds = effectiveRecipeIds.filter((id): id is string => id != null)
	if (new Set(linkedIds).size !== linkedIds.length) {
		return data(
			{
				result: submission.reply({
					formErrors: [DUPLICATE_MENU_RECIPE_MESSAGE],
				}),
			},
			{ status: 400 },
		)
	}

	// Every newly referenced Recipe must be visible to the household.
	const newlyReferencedIds = items.flatMap((item, index) => {
		const effective = effectiveRecipeIds[index]
		if (effective == null) return []
		if (item.id != null && storedById.get(item.id)!.recipeId === effective) {
			return []
		}
		return [effective]
	})
	const referencedRecipes = await prisma.recipe.findMany({
		where: { id: { in: newlyReferencedIds }, householdId },
		select: { id: true, title: true },
	})
	const recipesById = new Map(referencedRecipes.map((r) => [r.id, r]))
	if (newlyReferencedIds.some((id) => !recipesById.has(id))) {
		return data(
			{
				result: submission.reply({
					formErrors: ['That recipe is no longer in your library'],
				}),
			},
			{ status: 400 },
		)
	}

	const submittedIds = new Set(
		items.flatMap((item) => (item.id != null ? [item.id] : [])),
	)
	const removedItemIds = storedItems
		.filter((item) => !submittedIds.has(item.id))
		.map((item) => item.id)

	try {
		// One atomic Save — Menu fields and every card change persist together
		// or not at all.
		await prisma.$transaction(async (tx) => {
			await tx.menu.update({
				where: { id: menuId },
				data: {
					title,
					titleKey: menuTitleKey(title),
					description: description ?? null,
					defaultGuestCount: defaultGuestCount ?? null,
				},
			})

			if (removedItemIds.length > 0) {
				await tx.menuItem.deleteMany({
					where: { id: { in: removedItemIds } },
				})
			}

			for (const [index, item] of items.entries()) {
				if (item.id != null) {
					const stored = storedById.get(item.id)!
					const replacement =
						item.recipeId != null && item.recipeId !== stored.recipeId
							? recipesById.get(item.recipeId)!
							: null
					await tx.menuItem.update({
						where: { id: item.id },
						data: {
							order: index,
							scaleMultiplier: item.scaleMultiplier,
							note: item.note ?? null,
							// Replacing a card re-freezes the display title from the new
							// Recipe; otherwise the frozen identity stays untouched.
							...(replacement && {
								recipeId: replacement.id,
								recipeTitle: replacement.title,
							}),
						},
					})
				} else {
					const recipe = recipesById.get(item.recipeId!)!
					await tx.menuItem.create({
						data: {
							kind: 'recipe',
							order: index,
							sectionId: unnamedSection.id,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: item.scaleMultiplier,
							note: item.note ?? null,
						},
					})
				}
			}
		})
		return redirect(`/recipes/menus/${menuId}`)
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			return data(
				{
					result: submission.reply({
						fieldErrors: { title: [DUPLICATE_MENU_TITLE_MESSAGE] },
					}),
				},
				{ status: 400 },
			)
		}
		throw error
	}
}

export default function EditMenu({ loaderData }: Route.ComponentProps) {
	const { menu, items, recipes } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">Edit Menu</h1>
			<MenuForm
				menu={menu}
				submitLabel="Save Changes"
				builder={{ items, recipes }}
			/>
			<div className="mt-8 border-t pt-8">
				<DeleteMenu />
			</div>
		</div>
	)
}

function DeleteMenu() {
	const dc = useDoubleCheck()
	const fetcher = useFetcher()
	const isDeleting = fetcher.state !== 'idle'

	return (
		<fetcher.Form method="POST">
			<input type="hidden" name="intent" value="delete" />
			<StatusButton
				{...dc.getButtonProps({
					type: 'submit',
					name: 'intent',
					value: 'delete',
				})}
				variant={dc.doubleCheck ? 'destructive' : 'outline'}
				status={isDeleting ? 'pending' : 'idle'}
			>
				<Icon name="trash" size="sm">
					{dc.doubleCheck ? 'Are you sure?' : 'Delete Menu'}
				</Icon>
			</StatusButton>
		</fetcher.Form>
	)
}
