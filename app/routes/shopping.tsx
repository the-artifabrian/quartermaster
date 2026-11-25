import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data } from 'react-router'
import { OfflineErrorBoundary } from '#app/components/offline-error-boundary.tsx'
import { ShoppingListRoute } from '#app/components/shopping-screen.tsx'
import {
	getPreviousWeek,
	getNextWeek,
	getWeekStart,
	parseDate,
	serializeDate,
	formatWeekRange,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	combineRowDisplay,
	demandIdentity,
} from '#app/utils/shopping-demand.server.ts'
import { ensureShoppingList } from '#app/utils/shopping-list-persistence.server.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { staleWhileRevalidate } from '#app/utils/loader-cache.ts'
import { type Route } from './+types/shopping.ts'
import { shoppingActions } from './shopping-action.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Shopping | Quartermaster' }]
}

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, isProActive } =
		await requireUserWithTier(request)

	const ensuredShoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
	})
	// Each row ships with a display quantity grouped from its current Meal
	// contributions. It is computed here and never written back, so manual
	// rows and contributions both keep their stored values.
	const rowsWithContributions = await prisma.shoppingListItem.findMany({
		where: { listId: ensuredShoppingList.id },
		orderBy: [{ checked: 'asc' }],
		include: {
			mealContributions: { select: { quantity: true, unit: true } },
		},
	})
	const shoppingList = {
		...ensuredShoppingList,
		items: rowsWithContributions.map(({ mealContributions, ...item }) => ({
			...item,
			display: combineRowDisplay({
				source: item.source,
				quantity: item.quantity,
				unit: item.unit,
				contributions: mealContributions,
			}),
		})),
	}
	// SQLite's name ordering is ASCII-cased ("Shaoxing wine" before
	// "broccoli"); re-sort locale-aware so the flat list reads alphabetical.
	shoppingList.items.sort(
		(a, b) =>
			Number(a.checked) - Number(b.checked) ||
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
	)

	// Check prev/current/next weeks for meal plans. "Current" is the week of
	// the browser's today.
	const today = getRequestToday(request)
	const currentWeek = getWeekStart(parseDate(today))
	const prevWeek = getPreviousWeek(currentWeek)
	const nextWeek = getNextWeek(currentWeek)

	// A week counts as planned when one of its Meals can contribute Shopping
	// demand: a Recipe item or a note card's Shopping lines. Text-only Meals
	// put nothing on Shopping, so a week of only "Leftovers" has nothing to
	// offer the picker.
	const mealPlans = await prisma.mealPlan.findMany({
		where: {
			householdId,
			weekStart: { in: [prevWeek, currentWeek, nextWeek] },
		},
		select: {
			weekStart: true,
			meals: {
				where: {
					genericText: null,
					OR: [
						{ recipeItems: { some: {} } },
						{ noteItems: { some: { shoppingLines: { some: {} } } } },
					],
				},
				select: { id: true },
				take: 1,
			},
		},
	})

	const weeksWithPlans = [prevWeek, currentWeek, nextWeek]
		.filter((week) =>
			mealPlans.some(
				(mp) =>
					mp.weekStart.getTime() === week.getTime() && mp.meals.length > 0,
			),
		)
		.map((week) => ({
			weekStart: serializeDate(week),
			label: formatWeekRange(week, today),
			isCurrent: week.getTime() === currentWeek.getTime(),
		}))

	const hasMealPlan = weeksWithPlans.length > 0
	const shoppingIdentities = [
		...new Set(shoppingList.items.map((item) => demandIdentity(item.name))),
	]
	return {
		shoppingList,
		hasMealPlan,
		weeksWithPlans,
		isProActive,
		shoppingIdentities,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId } = await requireUserWithTier(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	const shoppingList = await ensureShoppingList(prisma, {
		userId,
		householdId,
	})

	if (typeof intent === 'string' && Object.hasOwn(shoppingActions, intent)) {
		return shoppingActions[intent as keyof typeof shoppingActions]({
			formData,
			userId,
			householdId,
			shoppingList,
		})
	}

	// An intent this page doesn't send, such as delete or Clear checked from a
	// tab opened before Undo (those go to resources/undo-delete). It saves
	// nothing, and the status says so; a 200 would read as done.
	return data({ status: 'error' as const }, { status: 400 })
}

export const ErrorBoundary = OfflineErrorBoundary

// Shows the last data for this URL at once on a navigation and revalidates
// behind it; see loader-cache.ts.
export async function clientLoader(args: Route.ClientLoaderArgs) {
	return staleWhileRevalidate(args)
}
clientLoader.hydrate = false as const

export default ShoppingListRoute
