import { parseWithZod } from '@conform-to/zod'
import { invariantResponse } from '@epic-web/invariant'
import { parseFormData, type FileUpload } from '@mjackson/form-data-parser'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect, useFetcher } from 'react-router'
import { RecipeForm } from '#app/components/recipe-form.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	ACCEPTED_RECIPE_IMAGE_TYPES,
} from '#app/utils/recipe-validation.ts'
import {
	uploadRecipeImage,
	deleteRecipeImage,
} from '#app/utils/storage.server.ts'
import { type Route } from './+types/$recipeId_.edit.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Edit Recipe | Quartermaster' }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: {
			id: true,
			title: true,
			description: true,
			servings: true,
			prepTime: true,
			cookTime: true,
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
		},
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return { recipe }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: { id: true, title: true, householdId: true },
	})

	invariantResponse(recipe, 'Recipe not found', { status: 404 })
	invariantResponse(recipe.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	let imageFile: FileUpload | null = null

	const formData = await parseFormData(
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

	const intent = formData.get('intent')

	// Handle delete
	if (intent === 'delete') {
		// Delete recipe image from storage if it exists
		const recipeWithImage = await prisma.recipe.findUnique({
			where: { id: recipeId },
			select: { image: { select: { objectKey: true } } },
		})

		if (recipeWithImage?.image?.objectKey) {
			try {
				await deleteRecipeImage(recipeWithImage.image.objectKey)
			} catch (error) {
				console.error('Failed to delete recipe image from storage:', error)
				// Continue with recipe deletion even if image deletion fails
			}
		}

		await prisma.recipe.delete({ where: { id: recipeId } })
		void emitHouseholdEvent({
			type: 'recipe_deleted',
			payload: { recipeId, title: recipe.title },
			userId,
			householdId,
		})
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

	const { title, description, servings, prepTime, cookTime, sourceUrl, notes } =
		submission.value

	// Update recipe - delete all ingredients and instructions, then recreate
	await prisma.$transaction([
		prisma.ingredient.deleteMany({ where: { recipeId } }),
		prisma.instruction.deleteMany({ where: { recipeId } }),
		prisma.recipe.update({
			where: { id: recipeId },
			data: {
				title,
				description: description ?? null,
				servings,
				prepTime,
				cookTime,
				sourceUrl: sourceUrl || null,
				notes: notes || null,
				ingredients: {
					create: ingredients
						.filter((ing) => ing.name.trim() !== '')
						.map((ing, order) => ({
							name: ing.name,
							amount: ing.amount || null,
							unit: ing.unit || null,
							notes: ing.notes || null,
							isHeading: ing.isHeading ?? false,
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
		}),
	])

	// Upload image if provided
	if (imageFile) {
		// Get existing image to delete from storage
		const existingImage = await prisma.recipeImage.findUnique({
			where: { recipeId },
			select: { objectKey: true },
		})

		// Delete existing image from storage if it exists
		if (existingImage?.objectKey) {
			try {
				await deleteRecipeImage(existingImage.objectKey)
			} catch (error) {
				console.error('Failed to delete old recipe image from storage:', error)
				// Continue with new image upload even if old image deletion fails
			}
		}

		// Delete existing image record and create new one
		await prisma.recipeImage.deleteMany({ where: { recipeId } })
		const objectKey = await uploadRecipeImage(userId, recipeId, imageFile)
		await prisma.recipeImage.create({
			data: {
				recipeId,
				objectKey,
			},
		})
	}

	void emitHouseholdEvent({
		type: 'recipe_updated',
		payload: { recipeId, title },
		userId,
		householdId,
	})

	return redirect(`/recipes/${recipeId}`)
}

export default function EditRecipe({ loaderData }: Route.ComponentProps) {
	const { recipe } = loaderData

	return (
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<h1 className="mb-6 text-2xl font-bold">Edit Recipe</h1>
			<RecipeForm recipe={recipe} submitLabel="Save Changes" />
			<div className="mt-8 border-t pt-8">
				<DeleteRecipe recipeId={recipe.id} />
			</div>
		</div>
	)
}

function DeleteRecipe({ recipeId: _recipeId }: { recipeId: string }) {
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
					{dc.doubleCheck ? 'Are you sure?' : 'Delete Recipe'}
				</Icon>
			</StatusButton>
		</fetcher.Form>
	)
}
