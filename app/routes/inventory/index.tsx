import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data } from 'react-router'
import { ActiveStaples } from '#app/components/active-staples.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	HouseholdIngredientDisplayNameSchema,
	householdIngredientKey,
} from '#app/utils/household-ingredient.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import {
	type NextShopRestockEffect,
	resolveNextShopRestockTarget,
} from '#app/utils/shopping-horizon.server.ts'
import { demandIdentity } from '#app/utils/shopping-demand.server.ts'
import { NEXT_SHOP } from '#app/utils/shopping-horizon.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { guessCategory } from '#app/utils/shopping-list-validation.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Staples | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	// Each row says whether it is already waiting in Next shop, because that is
	// the question the screen exists to answer and a banner at the top of a
	// long list cannot. "Waiting" is exactly the state that makes another add a
	// no-op: an unchecked Next-shop row is the preferred restock target, so a
	// Later or checked match still has somewhere useful to go.
	const [staples, waitingRows] = await Promise.all([
		prisma.householdIngredient.findMany({
			where: { householdId, isStaple: true },
			orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
			select: { id: true, displayName: true },
		}),
		prisma.shoppingListItem.findMany({
			where: { list: { householdId }, checked: false, horizon: NEXT_SHOP },
			select: { name: true },
		}),
	])
	const waitingIdentities = new Set(
		waitingRows.map((row) => demandIdentity(row.name)),
	)

	return {
		staples: staples.map((staple) => ({
			...staple,
			onShoppingList: waitingIdentities.has(demandIdentity(staple.displayName)),
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'add-staple') {
		const parsed = HouseholdIngredientDisplayNameSchema.safeParse(
			formData.get('displayName'),
		)
		if (!parsed.success) {
			return data(
				{ status: 'error' as const, message: 'Enter a valid Staple name' },
				{ status: 400 },
			)
		}
		const canonicalKey = householdIngredientKey(parsed.data)
		try {
			// An identity the household already holds is re-classified rather
			// than duplicated: canonical key is household identity.
			await prisma.householdIngredient.upsert({
				where: {
					householdId_canonicalKey: { householdId, canonicalKey },
				},
				create: {
					householdId,
					displayName: parsed.data,
					canonicalKey,
					isStaple: true,
				},
				update: {
					displayName: parsed.data,
					isStaple: true,
				},
			})
		} catch {
			return data(
				{
					status: 'error' as const,
					action: 'add-staple' as const,
					message: `Could not add ${parsed.data}. Try again.`,
				},
				{ status: 500 },
			)
		}

		return { status: 'success' as const, action: 'add-staple' as const }
	}

	if (intent === 'add-staple-to-shop' || intent === 'remove-staple') {
		const itemId = formData.get('itemId')
		invariantResponse(typeof itemId === 'string', 'Staple ID is required')
		const staple = await prisma.householdIngredient.findFirst({
			where: { id: itemId, householdId, isStaple: true },
			select: { id: true, displayName: true },
		})
		invariantResponse(staple, 'Staple not found', { status: 404 })

		if (intent === 'add-staple-to-shop') {
			// The same resolution the Shopping page's Staples picker uses: a row
			// already in Next shop is left alone, a Later one moves up, and a
			// checked one comes back rather than arriving twice.
			let shoppingEffect: NextShopRestockEffect
			try {
				shoppingEffect = await prisma.$transaction(async (tx) => {
					const shoppingList = await ensureShoppingList(tx, {
						userId,
						householdId,
					})
					return resolveNextShopRestockTarget(tx, {
						listId: shoppingList.id,
						name: staple.displayName,
						category: guessCategory(staple.displayName),
					})
				})
			} catch {
				return data(
					{
						status: 'error' as const,
						action: 'add-staple-to-shop' as const,
						message: `Could not add ${staple.displayName} to Next shop. Try again.`,
					},
					{ status: 500 },
				)
			}

			// Only tell the other member something happened when it did. A row
			// already waiting in Next shop is not an addition.
			if (shoppingEffect !== 'already-in-next-shop') {
				await emitHouseholdEvent({
					type: 'shopping_list_item_added',
					payload: { name: staple.displayName },
					userId,
					householdId,
				})
			}
			return {
				status: 'success' as const,
				action: 'add-staple-to-shop' as const,
				shoppingEffect,
				message:
					shoppingEffect === 'added'
						? `${staple.displayName} was added to Next shop.`
						: shoppingEffect === 'moved'
							? `${staple.displayName} was moved to Next shop.`
							: shoppingEffect === 'resurfaced'
								? `${staple.displayName} was brought back to Next shop.`
								: `${staple.displayName} is already in Next shop.`,
			}
		}

		try {
			// The identity survives its classification: other household data may
			// reference this canonical key.
			await prisma.householdIngredient.update({
				where: { id: staple.id },
				data: { isStaple: false },
			})
		} catch {
			return data(
				{
					status: 'error' as const,
					action: 'remove-staple' as const,
					message: `Could not remove ${staple.displayName}. Try again.`,
				},
				{ status: 500 },
			)
		}
		return { status: 'success' as const, action: 'remove-staple' as const }
	}

	return data({ status: 'error' as const }, { status: 400 })
}

export default function StaplesIndex({ loaderData }: Route.ComponentProps) {
	return <ActiveStaples staples={loaderData.staples} />
}
