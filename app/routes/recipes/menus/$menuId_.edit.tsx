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
import { goneItemMiddleware } from '#app/components/gone-item.tsx'
import {
	NotInHouseholdBoundary,
	notFoundTitle,
} from '#app/components/not-in-household.tsx'
import { isOfflineReply, saveUnlessOffline } from '#app/utils/offline-save.ts'
import { type NavBarHandle, useLockNavBar } from '#app/components/nav-bar.tsx'
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
	existingIds,
	matchRows,
	newRowIdCandidates,
	newRowIds,
	readSeenIds,
} from '#app/utils/loaded-rows.ts'
import {
	DUPLICATE_MENU_TITLE_MESSAGE,
	isUniqueConstraintError,
	MenuBuilderSchema,
	menuTitleKey,
} from '#app/utils/menu-validation.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type Route } from './+types/$menuId_.edit.ts'

// Going back to this page once its item is gone opens /recipes/menus instead.
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	goneItemMiddleware('/recipes/menus'),
]

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: ({ params }) => menuEditNav(params.menuId!),
	navForm: MENU_FORM_ID,
}

export const meta: Route.MetaFunction = ({ error }) => {
	return [
		{ title: notFoundTitle(error, 'Menu') ?? 'Edit Menu | Quartermaster' },
	]
}

// Done saving or deleting, the screen leaves by itself (edit-screen.tsx):
// reloading it first would load a Menu that is gone, or about to be left.
// A Save offline keeps the form and its edits (offline-save.ts).
export async function clientAction(args: Route.ClientActionArgs) {
	return saveUnlessOffline(args, MenuBuilderSchema)
}

export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (isEditScreenDone(actionResult)) return false
	// Offline the reload would fail and replace the form with an error.
	if (isOfflineReply(actionResult)) return false
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
		select: { id: true, householdId: true },
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
	const seenSectionIds = readSeenIds(formData, 'loadedSectionIds')
	const seenItemIds = readSeenIds(formData, 'loadedItemIds')

	try {
		// One atomic Save. It reads the stored sections and cards in the same
		// transaction it writes in, so a change another member made after the
		// form loaded is either seen here or waits for this Save to finish.
		const saved = await writeTransaction(prisma, async (tx) => {
			const storedSections = await tx.menuSection.findMany({
				where: { menuId },
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					order: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeId: true,
							order: true,
							sectionId: true,
						},
					},
				},
			})

			// A blank name marks the headingless unnamed section; any section may
			// take or lose a name in place, so no stored row is special.
			const storedUnnamed = storedSections.find(
				(section) => section.name === null,
			)

			// The submission is the Menu as the editor left it. An absent (or
			// empty) sections key resets it to the default: one empty unnamed
			// section.
			const submittedSections = submission.value.sections
			const sections = (
				submittedSections?.length
					? submittedSections
					: [{ id: storedUnnamed?.id, name: undefined, items: [] }]
			).map((section) => ({ ...section, items: section.items ?? [] }))

			// The form posts each section once; the same id twice is refused.
			const postedSectionIds = sections.flatMap((section) =>
				section.id != null ? [section.id] : [],
			)
			invariantResponse(
				new Set(postedSectionIds).size === postedSectionIds.length,
				'Invalid menu section',
				{ status: 400 },
			)
			// An id that isn't one of this Menu's sections (another Menu's, or
			// one deleted meanwhile) saves as a new section (loaded-rows.ts).
			const sectionMatch = matchRows(
				storedSections,
				sections.map((section) => section.id),
				seenSectionIds,
			)

			// Items flattened with their submitted position: a stored item
			// appearing under a different section has been moved there.
			const items = sections.flatMap((section, sectionIndex) =>
				section.items.map((item, itemIndex) => ({
					...item,
					sectionIndex,
					itemIndex,
				})),
			)
			const postedItemIds = items.flatMap((item) =>
				item.id != null ? [item.id] : [],
			)
			invariantResponse(
				new Set(postedItemIds).size === postedItemIds.length,
				'Invalid menu item',
				{ status: 400 },
			)
			const storedItems = storedSections.flatMap((section) => section.items)
			// As for sections, a card id that isn't one of this Menu's cards
			// saves as a new card and never changes a card elsewhere.
			const itemMatch = matchRows(
				storedItems,
				items.map((item) => item.id),
				seenItemIds,
			)
			// A card's kind is immutable: a Recipe card never mutates into a note.
			invariantResponse(
				items.every((item, index) => {
					const stored = itemMatch.matches[index]
					return !stored || stored.kind === item.kind
				}),
				'Invalid menu item',
				{ status: 400 },
			)

			// Effective Recipe references after this save: a stored card keeps
			// its reference unless the submission replaces it (a missing card
			// submits an empty recipeId, which never unlinks a live one). Note
			// cards never reference a Recipe.
			const effectiveRecipeIds = items.map((item, index) => {
				if (item.kind === 'note') return null
				const stored = itemMatch.matches[index]
				if (stored) {
					return item.recipeId != null && item.recipeId !== stored.recipeId
						? item.recipeId
						: stored.recipeId
				}
				return item.recipeId ?? null
			})

			// Every newly referenced Recipe must be visible to the household.
			const newlyReferencedIds = items.flatMap((_, index) => {
				const effective = effectiveRecipeIds[index]
				if (effective == null) return []
				if (itemMatch.matches[index]?.recipeId === effective) return []
				return [effective]
			})
			const referencedRecipes = await tx.recipe.findMany({
				where: { id: { in: newlyReferencedIds }, householdId },
				select: { id: true, title: true },
			})
			const recipesById = new Map(referencedRecipes.map((r) => [r.id, r]))
			if (newlyReferencedIds.some((id) => !recipesById.has(id))) {
				return { recipeGone: true }
			}

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
			// every posted section takes its submitted position.
			// A new section or card is created with the id the form gave it
			// when no row has that id yet, so a replayed Save pairs with it.
			const postedSections = sections.map((section) => section.id)
			const newSectionIds = newRowIds(
				postedSections,
				sectionMatch.matches,
				seenSectionIds,
				await existingIds(
					tx.menuSection,
					newRowIdCandidates(
						postedSections,
						sectionMatch.matches,
						seenSectionIds,
					),
				),
			)
			const postedItems = items.map((item) => item.id)
			const newItemIds = newRowIds(
				postedItems,
				itemMatch.matches,
				seenItemIds,
				await existingIds(
					tx.menuItem,
					newRowIdCandidates(postedItems, itemMatch.matches, seenItemIds),
				),
			)

			const sectionIds: string[] = []
			for (const [index, section] of sections.entries()) {
				const stored = sectionMatch.matches[index]
				if (stored) {
					await tx.menuSection.update({
						where: { id: stored.id },
						data: { order: index, name: section.name ?? null },
					})
					sectionIds.push(stored.id)
				} else {
					const created = await tx.menuSection.create({
						data: {
							id: newSectionIds[index],
							menuId,
							name: section.name ?? null,
							order: index,
						},
						select: { id: true },
					})
					sectionIds.push(created.id)
				}
			}

			for (const [index, item] of items.entries()) {
				const sectionId = sectionIds[item.sectionIndex]!
				const stored = itemMatch.matches[index]
				if (item.kind === 'note') {
					// A note card's lines are replaced wholesale from the submission;
					// they carry no identity beyond their fields, so the save simply
					// rewrites them in submitted order.
					const lines = (item.shoppingLines ?? []).map((line, order) => ({
						name: line.name,
						quantity: line.quantity ?? null,
						unit: line.unit ?? null,
						order,
					}))
					if (stored) {
						await tx.menuItem.update({
							where: { id: stored.id },
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
								id: newItemIds[index],
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
				if (stored) {
					const replacement =
						item.recipeId != null && item.recipeId !== stored.recipeId
							? recipesById.get(item.recipeId)!
							: null
					await tx.menuItem.update({
						where: { id: stored.id },
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
					// A missing card that another member removed meanwhile has no
					// Recipe to save again, so it stays removed.
					const recipeId = effectiveRecipeIds[index]
					if (recipeId == null) continue
					const recipe = recipesById.get(recipeId)!
					await tx.menuItem.create({
						data: {
							id: newItemIds[index],
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

			// Only cards the form loaded and left out go. A card added after the
			// form loaded stays, after the saved cards of its section. One in a
			// section the editor removed moves to the end of the first section,
			// so the removed section can go.
			if (itemMatch.removed.length > 0) {
				await tx.menuItem.deleteMany({
					where: { id: { in: itemMatch.removed.map((item) => item.id) } },
				})
			}
			const postedCount = new Map(
				sectionIds.map((id, index) => [id, sections[index]!.items.length]),
			)
			const removedSectionIds = new Set(
				sectionMatch.removed.map((section) => section.id),
			)
			const firstSectionId = sectionIds[0]!
			const unseenItems = [
				...itemMatch.unseen.filter((item) => postedCount.has(item.sectionId)),
				...itemMatch.unseen.filter((item) =>
					removedSectionIds.has(item.sectionId),
				),
			]
			for (const item of unseenItems) {
				const sectionId = postedCount.has(item.sectionId)
					? item.sectionId
					: firstSectionId
				const order = postedCount.get(sectionId)!
				postedCount.set(sectionId, order + 1)
				await tx.menuItem.update({
					where: { id: item.id },
					data: { order, sectionId },
				})
			}
			if (removedSectionIds.size > 0) {
				await tx.menuSection.deleteMany({
					where: { id: { in: [...removedSectionIds] } },
				})
			}
			// A section added after the form loaded stays, after the saved ones.
			for (const [index, section] of sectionMatch.unseen.entries()) {
				await tx.menuSection.update({
					where: { id: section.id },
					data: { order: sections.length + index },
				})
			}
			return { recipeGone: false }
		})
		if (saved.recipeGone) {
			return data(
				{
					result: submission.reply({
						formErrors: ['That Recipe isn’t in your Recipes any more'],
					}),
				},
				{ status: 400 },
			)
		}
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
	// Cancel or Save while it deletes would land on, or post to, a gone item.
	useLockNavBar(isDeleting)

	// Offline nothing was deleted; the toast says so, and the question goes.
	const offline = isOfflineReply(fetcher.data)
	useEffect(() => {
		if (offline) setConfirming(false)
	}, [fetcher.data, offline])

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
				className="text-foreground-destructive hover:text-foreground-destructive"
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

export function ErrorBoundary() {
	return <NotInHouseholdBoundary kind="Menu" />
}
