import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { redirect } from 'react-router'
import { SharedRecipeView } from '#app/components/shared-recipe.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { sharedRecipeSelect } from '#app/utils/share-menu.server.ts'
import { type Route } from './+types/share.$recipeId.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
	const recipe = loaderData?.recipe
	const title = recipe?.title
		? `${recipe.title} | Quartermaster`
		: 'Recipe | Quartermaster'
	const description =
		recipe?.description || `View recipe for ${recipe?.title ?? 'a dish'}`

	const rootMatch = matches.find((m) => m?.id === 'root')
	const origin = (
		rootMatch?.loaderData as { requestInfo?: { origin?: string } } | undefined
	)?.requestInfo?.origin

	const meta: ReturnType<Route.MetaFunction> = [
		{ title },
		{ name: 'description', content: description },
		{ property: 'og:title', content: title },
		{ property: 'og:description', content: description },
		{ property: 'og:type', content: 'article' },
		{ property: 'og:site_name', content: 'Quartermaster' },
	]

	if (origin && recipe) {
		meta.push({
			property: 'og:url',
			content: `${origin}/share/${recipe.id}`,
		})
	}

	if (origin && recipe?.image?.objectKey) {
		const imageUrl = `${origin}/resources/images?objectKey=${encodeURIComponent(recipe.image.objectKey)}&w=1200&h=630&fit=cover`
		meta.push(
			{ property: 'og:image', content: imageUrl },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: imageUrl },
		)
	} else {
		meta.push({ name: 'twitter:card', content: 'summary' })
	}

	meta.push(
		{ name: 'twitter:title', content: title },
		{ name: 'twitter:description', content: description },
	)

	return meta
}

export async function loader({ params, request }: Route.LoaderArgs) {
	const { recipeId } = params
	const userId = await getUserId(request)

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		select: sharedRecipeSelect,
	})

	if (!recipe) {
		throw new Response('Recipe not found', { status: 404 })
	}

	let alreadySaved = false
	if (userId) {
		const member = await prisma.householdMember.findFirst({
			where: { userId },
			select: { householdId: true },
		})
		if (member) {
			const existing = await prisma.recipe.findFirst({
				where: { householdId: member.householdId, title: recipe.title },
				select: { id: true },
			})
			alreadySaved = Boolean(existing)
		}
	}

	return { recipe, isLoggedIn: Boolean(userId), alreadySaved }
}

export async function action({ params, request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const { recipeId } = params

	const recipe = await prisma.recipe.findUnique({
		where: { id: recipeId },
		include: {
			ingredients: true,
			instructions: true,
			image: true,
		},
	})

	if (!recipe) {
		throw new Response('Recipe not found', { status: 404 })
	}

	// Prevent duplicates from double-clicks or resubmits
	const existing = await prisma.recipe.findFirst({
		where: { householdId, title: recipe.title },
		select: { id: true },
	})
	if (existing) {
		return redirect(`/recipes/${existing.id}`)
	}

	const newRecipe = await prisma.recipe.create({
		data: {
			title: recipe.title,
			description: recipe.description,
			activeTime: recipe.activeTime,
			totalTime: recipe.totalTime,
			yieldAmount: recipe.yieldAmount,
			yieldLabel: recipe.yieldLabel,
			isFavorite: false,
			sourceUrl: recipe.sourceUrl,
			rawText: recipe.rawText,
			userId,
			householdId,
			ingredients: {
				create: recipe.ingredients.map((ing) => ({
					name: ing.name,
					amount: ing.amount,
					unit: ing.unit,
					notes: ing.notes,
					isHeading: ing.isHeading,
					order: ing.order,
				})),
			},
			instructions: {
				create: recipe.instructions.map((inst) => ({
					content: inst.content,
					order: inst.order,
				})),
			},
			...(recipe.image
				? {
						image: {
							create: {
								altText: recipe.image.altText,
								objectKey: recipe.image.objectKey,
							},
						},
					}
				: {}),
		},
		select: { id: true },
	})

	return redirect(`/recipes/${newRecipe.id}`)
}

export default function SharedRecipeRoute({
	loaderData,
}: Route.ComponentProps) {
	return <SharedRecipeView key={loaderData.recipe.id} loaderData={loaderData} />
}
