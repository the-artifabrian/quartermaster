import { isToday, serializeDate } from './date.ts'

/**
 * The mobile Plan keeps its selected day in the URL as `?day=yyyy-MM-dd`, so
 * going back to Plan, or reloading it, shows the day the user picked.
 */

type DayMeal = { id: string; dateStr: string }

type SelectedDayArgs = {
	weekDays: Date[]
	meals: DayMeal[]
	/** The `mealId` search param: a link to one Meal. */
	mealId: string | null
	/** The `day` search param. */
	day: string | null
}

/**
 * The day the URL asks for: the linked Meal's day, else `day` when it names a
 * day of this week. Anything else (a malformed date, another week) is ignored.
 */
export function selectedDayFromUrl({
	weekDays,
	meals,
	mealId,
	day,
}: SelectedDayArgs): string | null {
	const mealDate = mealId
		? meals.find((meal) => meal.id === mealId)?.dateStr
		: undefined
	if (mealDate) return mealDate
	if (day && weekDays.some((date) => serializeDate(date) === day)) return day
	return null
}

/** Today when it is in the week, else the first day with Meals, else the first day. */
export function defaultSelectedDay(weekDays: Date[], meals: DayMeal[]): string {
	const today = weekDays.find(isToday)
	if (today) return serializeDate(today)
	return meals[0]?.dateStr ?? serializeDate(weekDays[0]!)
}

export function resolveSelectedDay(args: SelectedDayArgs): string {
	return (
		selectedDayFromUrl(args) ?? defaultSelectedDay(args.weekDays, args.meals)
	)
}

/** Search params that only pick what the page shows; the loader never reads them. */
const VIEW_PARAMS = ['day', 'mealId']

function dataSearch(url: URL) {
	const params = new URLSearchParams(url.search)
	for (const name of VIEW_PARAMS) params.delete(name)
	params.sort()
	return params.toString()
}

/**
 * The Plan route's `shouldRevalidate`: picking a day (which also drops a
 * Meal link's `mealId`) changes only view params on the same page, so the
 * loader is not asked again. Everything else, including a new `weekStart`,
 * a revalidation of the same URL and any form submission, follows the router.
 */
export function planShouldRevalidate({
	currentUrl,
	nextUrl,
	formMethod,
	defaultShouldRevalidate,
}: {
	currentUrl: URL
	nextUrl: URL
	formMethod?: string
	defaultShouldRevalidate: boolean
}) {
	if (
		!formMethod &&
		currentUrl.pathname === nextUrl.pathname &&
		currentUrl.search !== nextUrl.search &&
		dataSearch(currentUrl) === dataSearch(nextUrl)
	) {
		return false
	}
	return defaultShouldRevalidate
}
