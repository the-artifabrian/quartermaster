import { z } from 'zod'
import { getHints } from './client-hints.tsx'
import { getWeekStart, parseDate, todayInTimeZone } from './date.ts'

/**
 * The user's today for this request, as `yyyy-MM-dd`, from the browser's
 * timezone hint cookie. Before the hint exists (the first request, which the
 * hint check reloads at once) or with a zone the server doesn't know, it is
 * the UTC day.
 *
 * Each loader that draws Today, past days or "this week" calls this and puts
 * the result in its data, so the browser hydrates with the same day the
 * server rendered. It is fixed for that load: a page left open past midnight
 * keeps yesterday as Today until its next load or revalidation.
 */
export function getRequestToday(request: Request): string {
	return todayInTimeZone(getHints(request).timeZone)
}

/**
 * The week a request's `?weekStart=` asks for, as its Monday. Any day of the
 * week opens that week. Without the param, or with anything that isn't a
 * real `yyyy-MM-dd` day, it is the week holding `today` (the user's today,
 * from `getRequestToday`).
 */
export function getRequestWeekStart(request: Request, today: string): Date {
	const param = new URL(request.url).searchParams.get('weekStart')
	const day = z.iso.date().safeParse(param)
	return getWeekStart(parseDate(day.success ? day.data : today))
}
