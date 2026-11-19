import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useState } from 'react'
import {
	data,
	redirect,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
} from 'react-router'
import {
	ClientLeavesField,
	useLeaveEditScreen,
} from '#app/components/edit-screen.tsx'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import {
	MENU_FORM_ID,
	MenuForm,
	type MenuBuilderSection,
} from '#app/components/menu-form.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { ConfirmSheet } from '#app/components/ui/confirm-sheet.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { prisma } from '#app/utils/db.server.ts'
import {
	clientLeaves,
	type EditScreenDone,
	isEditScreenDone,
} from '#app/utils/edit-screen.ts'
import {
	getHistoryLog,
	menuEditNav,
	menuPages,
	resolveAfterDelete,
} from '#app/utils/nav-back.ts'
import { historyIndex } from '#app/utils/nav-direction.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuBuilderSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { type Route } from './+types/$menuId_.edit.ts'

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: ({ params }) => menuEditNav(params.menuId!),
	navForm: MENU_FORM_ID,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Edit Menu | Quartermaster' }]
}

// Done saving or deleting, the screen leaves by itself (edit-screen.tsx):
// reloading it first would load a Menu that is gone, or about to be left.
export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (isEditScreenDone(actionResult)) return false
	return defaultShouldRevalidate
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
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: { name: true, quantity: true, unit: true },
							},
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

	const sections: MenuBuilderSection[] = menu.sections.map((section) => ({
		id: section.id,
		name: section.name,
		items: section.items.map((item) =>
			item.kind === 'note'
				? {
						id: item.id,
						kind: 'note' as const,
						text: item.note ?? '',
						shoppingLines: item.shoppingLines,
					}
				: {
						id: item.id,
						kind: 'recipe' as const,
						recipeId: item.recipeId,
						recipeTitle: item.recipeTitle ?? 'Recipe',
						scaleMultiplier: item.scaleMultiplier ?? 1,
						note: item.note,
					},
		),
	}))

	const recipes = await prisma.recipe.findMany({
		where: { householdId },
		select: {
			id: true,
			title: true,
			totalTime: true,
			yieldAmount: true,
			yieldLabel: true,
			isFavorite: true,
			image: { select: { objectKey: true } },
		},
		orderBy: { title: 'asc' },
	})

	return { menu, sections, recipes }
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
					name: true,
					items: { select: { id: true, kind: true, recipeId: true } },
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
		if (clientLeaves(formData)) {
			return data({ done: '/recipes/menus' } satisfies EditScreenDone)
		}
		return redirect('/recipes/menus')
	}

	const submission = parseWithZod(formData, { schema: MenuBuilderSchema })

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, description, defaultGuestCount } = submission.value

	// A blank name marks the headingless unnamed section; any section may take
	// or lose a name in place (#149), so no stored row is special.
	const storedUnnamed = menu.sections.find((section) => section.name === null)

	// Full-state reconcile: the submission is the Menu's complete composition.
	// An absent (or empty) sections key resets it to the default — one empty
	// unnamed section (#102's note items must join this round-trip).
	const submittedSections = submission.value.sections
	const sections = (
		submittedSections?.length
			? submittedSections
			: [{ id: storedUnnamed?.id, name: undefined, items: [] }]
	).map((section) => ({ ...section, items: section.items ?? [] }))

	const storedSectionsById = new Map(menu.sections.map((s) => [s.id, s]))
	const submittedSectionIds = sections.flatMap((section) =>
		section.id != null ? [section.id] : [],
	)
	// Submitted section ids must belong to this menu, once each.
	invariantResponse(
		submittedSectionIds.every((id) => storedSectionsById.has(id)) &&
			new Set(submittedSectionIds).size === submittedSectionIds.length,
		'Invalid menu section',
		{ status: 400 },
	)

	// Items flattened with their submitted position — a stored item appearing
	// under a different section is an explicit cross-section move.
	const items = sections.flatMap((section, sectionIndex) =>
		section.items.map((item, itemIndex) => ({
			...item,
			sectionIndex,
			itemIndex,
		})),
	)

	const storedItems = menu.sections.flatMap((section) => section.items)
	const storedById = new Map(storedItems.map((item) => [item.id, item]))

	// Submitted item ids must belong to this menu, once each — reject forged
	// or duplicated ids outright.
	const submittedItemIds = items.flatMap((item) =>
		item.id != null ? [item.id] : [],
	)
	invariantResponse(
		submittedItemIds.every((id) => storedById.has(id)) &&
			new Set(submittedItemIds).size === submittedItemIds.length,
		'Invalid menu item',
		{ status: 400 },
	)
	// A card's kind is immutable — a Recipe card never mutates into a note.
	invariantResponse(
		items.every(
			(item) => item.id == null || storedById.get(item.id)!.kind === item.kind,
		),
		'Invalid menu item',
		{ status: 400 },
	)

	// Effective Recipe references after this save: an existing item keeps its
	// stored reference unless the submission explicitly replaces it (a missing
	// card submits an empty recipeId, which never unlinks a live one). Note
	// cards never reference a Recipe.
	const effectiveRecipeIds = items.map((item) => {
		if (item.kind === 'note') return null
		if (item.id != null) {
			const stored = storedById.get(item.id)!
			return item.recipeId != null && item.recipeId !== stored.recipeId
				? item.recipeId
				: stored.recipeId
		}
		return item.recipeId ?? null
	})

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

	const submittedIds = new Set(submittedItemIds)
	const removedItemIds = storedItems
		.filter((item) => !submittedIds.has(item.id))
		.map((item) => item.id)
	const submittedSectionIdSet = new Set(submittedSectionIds)
	const removedSectionIds = menu.sections
		.filter((section) => !submittedSectionIdSet.has(section.id))
		.map((section) => section.id)

	try {
		// One atomic Save — Menu fields and every section and card change
		// persist together or not at all.
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

			// Sections first: new ones need ids before their items persist, and
			// every surviving section takes its submitted position.
			const sectionIds: string[] = []
			for (const [index, section] of sections.entries()) {
				if (section.id != null) {
					await tx.menuSection.update({
						where: { id: section.id },
						data: { order: index, name: section.name ?? null },
					})
					sectionIds.push(section.id)
				} else {
					const created = await tx.menuSection.create({
						data: { menuId, name: section.name ?? null, order: index },
						select: { id: true },
					})
					sectionIds.push(created.id)
				}
			}

			for (const item of items) {
				const sectionId = sectionIds[item.sectionIndex]!
				if (item.kind === 'note') {
					// A note card's lines are replaced wholesale from the submission —
					// they carry no identity beyond their fields, so the full-state
					// save simply rewrites them in submitted order.
					const lines = (item.shoppingLines ?? []).map((line, order) => ({
						name: line.name,
						quantity: line.quantity ?? null,
						unit: line.unit ?? null,
						order,
					}))
					if (item.id != null) {
						await tx.menuItem.update({
							where: { id: item.id },
							data: {
								order: item.itemIndex,
								sectionId,
								note: item.text!,
								shoppingLines: { deleteMany: {}, create: lines },
							},
						})
					} else {
						await tx.menuItem.create({
							data: {
								kind: 'note',
								order: item.itemIndex,
								sectionId,
								note: item.text!,
								shoppingLines: { create: lines },
							},
						})
					}
					continue
				}
				if (item.id != null) {
					const stored = storedById.get(item.id)!
					const replacement =
						item.recipeId != null && item.recipeId !== stored.recipeId
							? recipesById.get(item.recipeId)!
							: null
					await tx.menuItem.update({
						where: { id: item.id },
						data: {
							order: item.itemIndex,
							sectionId,
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
							order: item.itemIndex,
							sectionId,
							recipeId: recipe.id,
							recipeTitle: recipe.title,
							scaleMultiplier: item.scaleMultiplier,
							note: item.note ?? null,
						},
					})
				}
			}

			if (removedItemIds.length > 0) {
				await tx.menuItem.deleteMany({
					where: { id: { in: removedItemIds } },
				})
			}
			// After the item moves above, a removed section only cascades onto
			// rows already deleted — surviving items were re-parented first.
			if (removedSectionIds.length > 0) {
				await tx.menuSection.deleteMany({
					where: { id: { in: removedSectionIds } },
				})
			}
		})
		if (clientLeaves(formData)) {
			return data({
				done: `/recipes/menus/${menuId}`,
			} satisfies EditScreenDone)
		}
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
	const { menu, sections, recipes } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">Edit Menu</h1>
			<MenuForm menu={menu} builder={{ sections, recipes }} />
			<div className="mt-8 border-t pt-8">
				<DeleteMenu menuId={menu.id} />
			</div>
		</div>
	)
}

function DeleteMenu({ menuId }: { menuId: string }) {
	const [confirming, setConfirming] = useState(false)
	const fetcher = useFetcher()
	const { leaving, leave } = useLeaveEditScreen()
	const isDeleting = fetcher.state !== 'idle' || leaving

	// Gone: back to Menus, with none of the Menu's pages behind it.
	const done = isEditScreenDone(fetcher.data) ? fetcher.data.done : null
	useEffect(() => {
		if (!done) return
		leave(
			resolveAfterDelete({
				idx: historyIndex(),
				log: getHistoryLog(),
				to: done,
				gone: menuPages(menuId),
			}),
		)
		// Once per answer.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetcher.data])

	return (
		<fetcher.Form method="POST" id="delete-menu">
			<input type="hidden" name="intent" value="delete" />
			<ClientLeavesField />
			<Button
				type="button"
				variant="outline"
				className="text-destructive hover:text-destructive"
				onClick={() => setConfirming(true)}
			>
				<Icon name="trash" size="sm">
					Delete Menu
				</Icon>
			</Button>
			<ConfirmSheet
				open={confirming}
				onCancel={() => setConfirming(false)}
				title="Delete this Menu?"
				description="Its sections and notes go for good. Your Recipes stay."
				confirmLabel="Delete Menu"
				formId="delete-menu"
				pending={isDeleting}
			/>
		</fetcher.Form>
	)
}
