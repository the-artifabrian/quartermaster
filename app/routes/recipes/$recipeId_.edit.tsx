import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import {
	MaxFileSizeExceededError,
	parseFormData,
	type FileUpload,
} from '@mjackson/form-data-parser'
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
import { isOfflineReply, saveUnlessOffline } from '#app/utils/offline-save.ts'
import { type NavBarHandle, useLockNavBar } from '#app/components/nav-bar.tsx'
import { RECIPE_FORM_ID, RecipeForm } from '#app/components/recipe-form.tsx'
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
	recipeEditNav,
	recipePages,
	resolveAfterDelete,
} from '#app/utils/nav-back.ts'
import { historyIndex } from '#app/utils/nav-direction.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	recipeMetadataOptions,
	RecipeMetadataSelectionError,
	resolveRecipeMetadataValueIds,
} from '#app/utils/recipe-metadata.server.ts'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	photoTooLargeResult,
	ACCEPTED_RECIPE_IMAGE_TYPES,
} from '#app/utils/recipe-validation.ts'
import { deleteRecipeImageUnlessShared } from '#app/utils/recipe-image.server.ts'
import {
	LINKED_RECIPE_GONE_MESSAGE,
	unlinkableRows,
} from '#app/utils/recipe-links.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import {
	deleteRecipeImage,
	uploadRecipeImage,
} from '#app/utils/storage.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type Route } from './+types/$recipeId_.edit.ts'

// Going back to this page once its item is gone opens /recipes instead.
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	goneItemMiddleware('/recipes'),
]

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: ({ params }) => recipeEditNav(params.recipeId!),
	navForm: RECIPE_FORM_ID,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Edit Recipe | Quartermaster' }]
}

// Done saving or deleting, the screen leaves by itself (edit-screen.tsx):
// reloading it first would load a Recipe that is gone, or about to be left.
// A Save offline keeps the form and its edits (offline-save.ts).
export async function clientAction(args: Route.ClientActionArgs) {
	return saveUnlessOffline(args, RecipeSchema)
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
	const { recipeId } = params

	const [recipe, metadataOptions] = await Promise.all([
		prisma.recipe.findUnique({
			where: { id: recipeId },
			select: {
				id: true,
				title: true,
				description: true,
				activeTime: true,
				totalTime: true,
				yieldAmount: true,
				yieldLabel: true,
				sourceUrl: true,
				notes: true,
				householdId: true,
				image: { select: { objectKey: true, altText: true } },
				ingredients: {
					select: {
						id: true,
						name: true,
						amount: true,
						unit: true,
						notes: true,
						isHeading: true,
						linkedRecipeId: true,
						linkedRecipe: { select: { title: true } },
					},
					orderBy: { order: 'asc' },
				},
				instructions: {
					select: {
						id: true,
						content: true,
					},
					orderBy: { order: 'asc' },
				},
				metadataAssignments: { select: { valueId: true } },
			},
		}),
		recipeMetadataOptions(householdId),
	])

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	// Map linkedRecipe.title to linkedRecipeTitle for the form
	const recipeForForm = {
		...recipe,
		metadataValueIds: recipe.metadataAssignments.map(
			(assignment) => assignment.valueId,
		),
		ingredients: recipe.ingredients.map((ing) => ({
			...ing,
			linkedRecipeTitle: ing.linkedRecipe?.title ?? null,
		})),
	}

	return { recipe: recipeForForm, metadataOptions }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: { id: true, householdId: true },
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	let imageFile: FileUpload | null = null

	let formData: FormData
	try {
		formData = await parseFormData(
			request,
			{ maxFileSize: MAX_RECIPE_IMAGE_SIZE },
			async (file) => {
				if (file.fieldName === 'image' && file.name) {
					if (file.size > MAX_RECIPE_IMAGE_SIZE) {
						return undefined
					}
					if (!ACCEPTED_RECIPE_IMAGE_TYPES.includes(file.type)) {
						return undefined
					}
					imageFile = file
					return file
				}
				return undefined
			},
		)
	} catch (error) {
		if (error instanceof MaxFileSizeExceededError) {
			return data({ result: photoTooLargeResult }, { status: 400 })
		}
		throw error
	}

	const intent = formData.get('intent')

	// Handle delete
	if (intent === 'delete') {
		// Drop the picture from storage unless a copy of this Recipe still shows
		// it; the row itself goes with the Recipe.
		const recipeWithImage = await prisma.recipe.findUnique({
			where: { id: recipeId },
			select: { title: true, image: { select: { objectKey: true } } },
		})

		if (recipeWithImage?.image?.objectKey) {
			try {
				await deleteRecipeImageUnlessShared(recipeWithImage.image.objectKey, {
					exceptRecipeId: recipeId,
				})
			} catch (error) {
				console.error('Failed to delete recipe image from storage:', error)
				// Continue with recipe deletion even if image deletion fails
			}
		}

		await prisma.recipe.delete({ where: { id: recipeId } })
		if (clientLeaves(formData)) {
			return data({ done: '/recipes' } satisfies EditScreenDone)
		}
		// Undo on a just-imported Recipe goes back to Import to try again.
		if (formData.get('undo') === 'import') {
			return redirectWithToast('/recipes/import', {
				type: 'success',
				description: `Removed ${recipeWithImage?.title ?? 'the Recipe'}`,
			})
		}
		return redirect('/recipes')
	}

	// Parse ingredients array from form data
	const ingredients: Array<{
		id?: string
		name: string
		amount?: string
		unit?: string
		notes?: string
		isHeading?: boolean
		linkedRecipeId?: string
	}> = []
	let i = 0
	while (formData.has(`ingredients[${i}].name`)) {
		ingredients.push({
			id: (formData.get(`ingredients[${i}].id`) as string) || undefined,
			name: formData.get(`ingredients[${i}].name`) as string,
			amount: (formData.get(`ingredients[${i}].amount`) as string) || undefined,
			unit: (formData.get(`ingredients[${i}].unit`) as string) || undefined,
			notes: (formData.get(`ingredients[${i}].notes`) as string) || undefined,
			isHeading: formData.get(`ingredients[${i}].isHeading`) === 'true',
			linkedRecipeId:
				(formData.get(`ingredients[${i}].linkedRecipeId`) as string) ||
				undefined,
		})
		i++
	}

	// Parse instructions array from form data
	const instructions: Array<{ id?: string; content: string }> = []
	i = 0
	while (formData.has(`instructions[${i}].content`)) {
		instructions.push({
			id: (formData.get(`instructions[${i}].id`) as string) || undefined,
			content: formData.get(`instructions[${i}].content`) as string,
		})
		i++
	}

	const submission = parseWithZod(formData, {
		schema: RecipeSchema.transform((data) => ({
			...data,
			ingredients,
			instructions,
		})),
	})

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const {
		title,
		description,
		activeTime,
		totalTime,
		yieldAmount,
		yieldLabel,
		recipeMetadata,
		sourceUrl,
		notes,
	} = submission.value

	// A sub-Recipe another member deleted while the form was open: the form
	// stays with its edits and says so at the row.
	const unlinkable = await unlinkableRows(ingredients, householdId)
	if (unlinkable.length > 0) {
		return data(
			{
				result: submission.reply({
					fieldErrors: Object.fromEntries(
						unlinkable.map((index) => [
							`ingredients[${index}].linkedRecipeId`,
							[LINKED_RECIPE_GONE_MESSAGE],
						]),
					),
				}),
			},
			{ status: 400 },
		)
	}

	// Update recipe - delete all ingredients and instructions, then recreate.
	// Classification identity resolves inside the same transaction, so a
	// spoofed foreign-household value cannot partially change the Recipe.
	try {
		await writeTransaction(prisma, async (tx) => {
			const metadataValueIds = await resolveRecipeMetadataValueIds(
				tx,
				householdId,
				recipeMetadata,
			)
			await tx.ingredient.deleteMany({ where: { recipeId } })
			await tx.instruction.deleteMany({ where: { recipeId } })
			await tx.recipe.update({
				where: { id: recipeId },
				data: {
					title,
					description: description ?? null,
					activeTime: activeTime ?? null,
					totalTime: totalTime ?? null,
					yieldAmount: yieldAmount ?? null,
					yieldLabel: yieldLabel ?? null,
					sourceUrl: sourceUrl || null,
					notes: notes || null,
					metadataAssignments: {
						deleteMany: {},
						create: metadataValueIds.map((valueId) => ({ valueId })),
					},
					ingredients: {
						create: ingredients
							.filter((ing) => ing.name.trim() !== '')
							.map((ing, order) => ({
								name: ing.name,
								amount: ing.amount || null,
								unit: ing.unit || null,
								notes: ing.notes || null,
								isHeading: ing.isHeading ?? false,
								linkedRecipeId: ing.linkedRecipeId || null,
								order,
							})),
					},
					instructions: {
						create: instructions
							.filter((inst) => inst.content.trim() !== '')
							.map((inst, order) => ({
								content: inst.content,
								order,
							})),
					},
				},
			})
		})
	} catch (error) {
		if (error instanceof RecipeMetadataSelectionError) {
			return data(
				{ result: submission.reply({ formErrors: [error.message] }) },
				{ status: 400 },
			)
		}
		throw error
	}

	// Upload the new photo before touching the old one, so a failed upload
	// leaves the Recipe with the photo it had.
	if (imageFile) {
		const existingImage = await prisma.recipeImage.findUnique({
			where: { recipeId },
			select: { objectKey: true },
		})
		const objectKey = await uploadRecipeImage(userId, recipeId, imageFile)
		try {
			await prisma.recipeImage.upsert({
				where: { recipeId },
				create: { recipeId, objectKey },
				update: { objectKey, altText: null },
			})
		} catch (error) {
			await deleteRecipeImage(objectKey).catch(() => {})
			throw error
		}

		// The row no longer points at the old object; delete it unless a copied
		// Recipe still shows it.
		if (existingImage?.objectKey) {
			try {
				await deleteRecipeImageUnlessShared(existingImage.objectKey)
			} catch (error) {
				console.error('Failed to delete old recipe image from storage:', error)
			}
		}
	}

	if (clientLeaves(formData)) {
		return data({ done: `/recipes/${recipeId}` } satisfies EditScreenDone)
	}
	return redirect(`/recipes/${recipeId}`)
}

export default function EditRecipe({ loaderData }: Route.ComponentProps) {
	const { recipe, metadataOptions } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">Edit Recipe</h1>
			<RecipeForm recipe={recipe} metadataOptions={metadataOptions} />
			<div className="mt-8 border-t pt-8">
				<DeleteRecipe recipeId={recipe.id} />
			</div>
		</div>
	)
}

function DeleteRecipe({ recipeId }: { recipeId: string }) {
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

	// Gone: back to the list, with none of the Recipe's pages behind it.
	const done = isEditScreenDone(fetcher.data) ? fetcher.data.done : null
	useEffect(() => {
		if (!done) return
		leave(
			resolveAfterDelete({
				idx: historyIndex(),
				log: getHistoryLog(),
				to: done,
				gone: recipePages(recipeId),
			}),
		)
		// Once per answer.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetcher.data])

	return (
		<fetcher.Form method="POST" id="delete-recipe">
			<input type="hidden" name="intent" value="delete" />
			<ClientLeavesField />
			<Button
				type="button"
				variant="outline"
				className="text-destructive hover:text-destructive"
				onClick={() => setConfirming(true)}
			>
				<Icon name="trash" size="sm">
					Delete Recipe
				</Icon>
			</Button>
			<ConfirmSheet
				open={confirming}
				onCancel={() => setConfirming(false)}
				title="Delete this Recipe?"
				description="Its ingredients, steps and photo go for good."
				confirmLabel="Delete Recipe"
				formId="delete-recipe"
				pending={isDeleting}
			/>
		</fetcher.Form>
	)
}
