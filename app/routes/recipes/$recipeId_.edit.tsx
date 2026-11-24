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
import { rethrowUnreadableUpload } from '#app/utils/form-body.server.ts'
import { checkRecipePhoto } from '#app/utils/recipe-photo.server.ts'
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
import {
	DEMO_PHOTO_DROPPED_MESSAGE,
	demoPhotoDroppedHeaders,
	isDemoUserId,
} from '#app/utils/demo-guard.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	recipeMetadataOptions,
	RecipeMetadataSelectionError,
	resolveRecipeMetadataValueIds,
} from '#app/utils/recipe-metadata.server.ts'
import { readSeenIds } from '#app/utils/loaded-rows.ts'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	parseRecipeForm,
	photoTooLargeResult,
	PHOTO_REFUSALS,
} from '#app/utils/recipe-validation.ts'
import { saveRecipeRows } from '#app/utils/recipe-rows.server.ts'
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
	// Photos are off in the demo: a demo user's file is dropped without being
	// checked or stored, and the Recipe saves without it.
	const demo = await isDemoUserId(userId)
	let photoDropped = false

	let formData: FormData
	try {
		formData = await parseFormData(
			request,
			{ maxFileSize: MAX_RECIPE_IMAGE_SIZE },
			async (file) => {
				if (file.fieldName === 'image' && file.name) {
					if (demo) {
						photoDropped = true
						return undefined
					}
					if (file.size > MAX_RECIPE_IMAGE_SIZE) {
						return undefined
					}
					// Its type is the browser's guess; checkRecipePhoto reads the bytes.
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
		rethrowUnreadableUpload(error)
	}

	const intent = formData.get('intent')

	// Handle delete
	if (intent === 'delete') {
		const recipeWithImage = await prisma.recipe.findUnique({
			where: { id: recipeId },
			select: { title: true, image: { select: { objectKey: true } } },
		})

		// The Recipe and its photo row go first, then the file, unless another
		// Recipe still shows it. In this order a share Save that copies the
		// photo's key either wrote its copy before the delete, and the count
		// sees it, or finds no photo to copy (share.$recipeId.tsx).
		await prisma.recipe.delete({ where: { id: recipeId } })
		if (recipeWithImage?.image?.objectKey) {
			try {
				await deleteRecipeImageUnlessShared(recipeWithImage.image.objectKey)
			} catch (error) {
				// The Recipe is gone either way; the file is left behind.
				console.error('Failed to delete recipe image from storage:', error)
			}
		}
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

	const { submission, ingredients, instructions } = parseRecipeForm(formData)

	// Checked before anything is saved, so a refused file leaves the Recipe
	// and its photo as they were.
	const check = imageFile
		? await checkRecipePhoto(imageFile, { signal: request.signal })
		: null
	if (check && !check.ok) {
		return data(
			{
				result: submission.reply({
					fieldErrors: { image: [PHOTO_REFUSALS[check.reason]] },
				}),
				photoRefusal: check.reason,
			},
			{ status: 400 },
		)
	}
	const photo = check?.photo

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

	// One transaction for the Recipe and its rows. Classification identity
	// resolves inside it, so a spoofed foreign-household value cannot
	// partially change the Recipe.
	try {
		const unlinkable = await writeTransaction(prisma, async (tx) => {
			// A sub-Recipe another member deleted while the form was open:
			// nothing is saved, and the form keeps its edits and says so at the
			// row. Checked here, so a delete just before the Save can't slip in.
			const unlinkable = await unlinkableRows(ingredients, householdId, tx)
			if (unlinkable.length > 0) return unlinkable
			const metadataValueIds = await resolveRecipeMetadataValueIds(
				tx,
				householdId,
				recipeMetadata,
			)
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
				},
			})
			await saveRecipeRows(
				tx,
				recipeId,
				{
					ingredients: ingredients.filter((ing) => ing.name.trim() !== ''),
					instructions: instructions.filter(
						(inst) => inst.content.trim() !== '',
					),
				},
				{
					ingredients: readSeenIds(formData, 'loadedIngredientIds'),
					instructions: readSeenIds(formData, 'loadedInstructionIds'),
				},
			)
			return []
		})
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
	if (photo) {
		const existingImage = await prisma.recipeImage.findUnique({
			where: { recipeId },
			select: { objectKey: true },
		})
		const objectKey = await uploadRecipeImage(userId, recipeId, photo)
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
		return data({
			done: `/recipes/${recipeId}`,
			...(photoDropped ? { notice: DEMO_PHOTO_DROPPED_MESSAGE } : {}),
		} satisfies EditScreenDone)
	}
	return redirect(`/recipes/${recipeId}`, {
		headers: photoDropped ? await demoPhotoDroppedHeaders() : undefined,
	})
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
