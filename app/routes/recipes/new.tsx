import { parseWithZod } from '@conform-to/zod/v4'
import { parseFormData, type FileUpload } from '@mjackson/form-data-parser'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, redirect } from 'react-router'
import { RecipeForm } from '#app/components/recipe-form.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	RecipeMetadataSelectionError,
	resolveRecipeMetadataValueIds,
} from '#app/utils/recipe-metadata.server.ts'
import {
	RecipeSchema,
	MAX_RECIPE_IMAGE_SIZE,
	ACCEPTED_RECIPE_IMAGE_TYPES,
} from '#app/utils/recipe-validation.ts'
import { uploadRecipeImage } from '#app/utils/storage.server.ts'
import { type Route } from './+types/new.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'New Recipe | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const metadataOptions = await prisma.recipeMetadataValue.findMany({
		where: { householdId },
		select: { id: true, dimension: true, name: true, nameKey: true },
		orderBy: [{ dimension: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
	})
	return { metadataOptions }
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
		isHeading?: boolean
		linkedRecipeId?: string
	}> = []
	let i = 0
	while (formData.has(`ingredients[${i}].name`)) {
		ingredients.push({
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
	const instructions: Array<{ content: string }> = []
	i = 0
	while (formData.has(`instructions[${i}].content`)) {
		instructions.push({
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

	let recipe: { id: string }
	try {
		recipe = await prisma.$transaction(async (tx) => {
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

	return redirect(`/recipes/${recipe.id}`)
}

export default function NewRecipe({ loaderData }: Route.ComponentProps) {
	return (
		<div className="container max-w-2xl py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6">
			<h1 className="mb-6 font-serif text-2xl font-normal">New Recipe</h1>
			<RecipeForm
				metadataOptions={loaderData.metadataOptions}
				submitLabel="Create Recipe"
			/>
		</div>
	)
}
