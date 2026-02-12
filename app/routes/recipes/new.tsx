import { parseWithZod } from '@conform-to/zod'
import { parseFormData, type FileUpload } from '@mjackson/form-data-parser'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect } from 'react-router'
import { RecipeForm } from '#app/components/recipe-form.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	ACCEPTED_RECIPE_IMAGE_TYPES,
} from '#app/utils/recipe-validation.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import { uploadRecipeImage } from '#app/utils/storage.server.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'New Recipe | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireUserWithHousehold(request)

	const tags = await prisma.tag.findMany({
		select: { id: true, name: true, category: true },
		orderBy: [{ category: 'asc' }, { name: 'asc' }],
	})

	return { tags }
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)

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

	// Parse ingredients array from form data
	const ingredients: Array<{
		name: string
		amount?: string
		unit?: string
		notes?: string
	}> = []
	let i = 0
	while (formData.has(`ingredients[${i}].name`)) {
		ingredients.push({
			name: formData.get(`ingredients[${i}].name`) as string,
			amount: (formData.get(`ingredients[${i}].amount`) as string) || undefined,
			unit: (formData.get(`ingredients[${i}].unit`) as string) || undefined,
			notes: (formData.get(`ingredients[${i}].notes`) as string) || undefined,
		})
		i++
	}

	// Parse instructions array from form data
	const instructions: Array<{ content: string }> = []
	i = 0
	while (formData.has(`instructions[${i}].content`)) {
		instructions.push({
			content: formData.get(`instructions[${i}].content`) as string,
		})
		i++
	}

	// Parse tagIds
	const tagIds = formData.getAll('tagIds') as string[]

	const submission = parseWithZod(formData, {
		schema: RecipeSchema.transform((data) => ({
			...data,
			ingredients,
			instructions,
			tagIds,
		})),
	})

	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}

	const { title, description, servings, prepTime, cookTime, sourceUrl, notes } =
		submission.value

	const recipe = await prisma.recipe.create({
		data: {
			title,
			description,
			servings,
			prepTime,
			cookTime,
			sourceUrl: sourceUrl || null,
			notes: notes || null,
			userId,
			householdId,
			ingredients: {
				create: ingredients
					.filter((ing) => ing.name.trim() !== '')
					.map((ing, order) => ({
						name: ing.name,
						amount: ing.amount || null,
						unit: ing.unit || null,
						notes: ing.notes || null,
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
			tags: {
				connect: tagIds.map((id) => ({ id })),
			},
		},
		select: { id: true },
	})

	// Upload image if provided
	if (imageFile) {
		const objectKey = await uploadRecipeImage(userId, recipe.id, imageFile)
		await prisma.recipeImage.create({
			data: {
				recipeId: recipe.id,
				objectKey,
			},
		})
	}

	void emitHouseholdEvent({
		type: 'recipe_created',
		payload: { recipeId: recipe.id, title },
		userId,
		householdId,
	})

	return redirect(`/recipes/${recipe.id}`)
}

export default function NewRecipe({ loaderData }: Route.ComponentProps) {
	return (
		<div className="container max-w-2xl py-6 pb-20 md:pb-6">
			<h1 className="mb-6 text-2xl font-bold">New Recipe</h1>
			<RecipeForm tags={loaderData.tags} submitLabel="Create Recipe" />
		</div>
	)
}
