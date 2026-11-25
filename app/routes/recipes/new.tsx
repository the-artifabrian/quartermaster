import {
	MaxFileSizeExceededError,
	parseFormData,
	type FileUpload,
} from '@mjackson/form-data-parser'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { isOfflineReply, saveUnlessOffline } from '#app/utils/offline-save.ts'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { recipeNewNav } from '#app/utils/nav-back.ts'
import { data, replace, type ShouldRevalidateFunctionArgs } from 'react-router'
import { RECIPE_FORM_ID, RecipeForm } from '#app/components/recipe-form.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { rethrowUnreadableUpload } from '#app/utils/form-body.server.ts'
import { checkRecipePhoto } from '#app/utils/recipe-photo.server.ts'
import {
	clientLeaves,
	type EditScreenDone,
	isEditScreenDone,
} from '#app/utils/edit-screen.ts'
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
import {
	LINKED_RECIPE_GONE_MESSAGE,
	unlinkableRows,
} from '#app/utils/recipe-links.server.ts'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	parseRecipeForm,
	photoTooLargeResult,
	PHOTO_REFUSALS,
} from '#app/utils/recipe-validation.ts'
import { uploadRecipeImage } from '#app/utils/storage.server.ts'
import { writeTransaction } from '#app/utils/write-transaction.server.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: recipeNewNav,
	navForm: RECIPE_FORM_ID,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'New Recipe | Quartermaster' }]
}

// A Save that went through leaves the form for the new page (edit-screen.tsx),
// so there is nothing to reload it for.
export function shouldRevalidate({
	actionResult,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	if (isEditScreenDone(actionResult)) return false
	// Offline the reload would fail and replace the form with an error.
	if (isOfflineReply(actionResult)) return false
	return defaultShouldRevalidate
}

// A Save offline keeps the form and its edits (offline-save.ts).
export async function clientAction(args: Route.ClientActionArgs) {
	return saveUnlessOffline(args, RecipeSchema)
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	return { metadataOptions: await recipeMetadataOptions(householdId) }
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

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

	const { submission, ingredients, instructions } = parseRecipeForm(formData)

	// Checked before anything is saved, so a refused file leaves no Recipe
	// behind.
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

	let saved: { unlinkable: number[] } | { id: string }
	try {
		saved = await writeTransaction(prisma, async (tx) => {
			// A sub-Recipe another member deleted while the form was open:
			// nothing is saved, and the form keeps its edits and says so at the
			// row. Checked here, so a delete just before the Save can't slip in.
			const unlinkable = await unlinkableRows(ingredients, householdId, tx)
			if (unlinkable.length > 0) return { unlinkable }
			const metadataValueIds = await resolveRecipeMetadataValueIds(
				tx,
				householdId,
				recipeMetadata,
			)
			return tx.recipe.create({
				data: {
					title,
					description: description ?? null,
					activeTime,
					totalTime,
					yieldAmount,
					yieldLabel,
					sourceUrl: sourceUrl || null,
					notes: notes || null,
					userId,
					householdId,
					metadataAssignments: {
						create: metadataValueIds.map((valueId) => ({ valueId })),
					},
					// Every row is new here: the ids a form posts are ignored.
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
				select: { id: true },
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

	if ('unlinkable' in saved) {
		return data(
			{
				result: submission.reply({
					fieldErrors: Object.fromEntries(
						saved.unlinkable.map((index) => [
							`ingredients[${index}].linkedRecipeId`,
							[LINKED_RECIPE_GONE_MESSAGE],
						]),
					),
				}),
			},
			{ status: 400 },
		)
	}
	const recipe = saved

	if (photo) {
		const objectKey = await uploadRecipeImage(userId, recipe.id, photo)
		await prisma.recipeImage.create({
			data: {
				recipeId: recipe.id,
				objectKey,
			},
		})
	}

	// The new Recipe takes the form's place: going back from it goes to the
	// page before the form. A hydrated form leaves by itself, sliding back as
	// an edit screen does (edit-screen.tsx).
	if (clientLeaves(formData)) {
		return data({
			done: `/recipes/${recipe.id}`,
			...(photoDropped ? { notice: DEMO_PHOTO_DROPPED_MESSAGE } : {}),
		} satisfies EditScreenDone)
	}
	return replace(`/recipes/${recipe.id}`, {
		headers: photoDropped ? await demoPhotoDroppedHeaders() : undefined,
	})
}

export default function NewRecipe({ loaderData }: Route.ComponentProps) {
	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl">New Recipe</h1>
			<RecipeForm metadataOptions={loaderData.metadataOptions} />
		</div>
	)
}
