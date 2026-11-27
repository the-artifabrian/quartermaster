import {
	addDaysUTC,
	formatMonthDay,
	formatWeekRange,
	formatWeekdayName,
	getWeekDays,
	getWeekStart,
	parseDate,
	serializeDate,
} from './date.ts'

/** A day in the date strip under Plan's title, as a phone shows it. */
export type StripDay = {
	/** `yyyy-MM-dd`. */
	date: string
	/** "Mon". */
	weekday: string
	dayOfMonth: number
	today: boolean
	/** Before today: drawn in faint text. */
	past: boolean
	picked: boolean
}

/**
 * What a phone's Plan shows with `picked` chosen, around the visitor's
 * `today`: the week's range, its strip, and the day's heading. Both are
 * `yyyy-MM-dd`. The homepage's pictures of Plan draw from this alone, so the
 * server and the browser draw the same days.
 */
export function planDayOnPhone(today: string, picked: string) {
	const pickedDate = parseDate(picked)
	const weekStart = getWeekStart(pickedDate)
	const strip: StripDay[] = getWeekDays(weekStart).map((date) => {
		const day = serializeDate(date)
		return {
			date: day,
			weekday: formatWeekdayName(date).slice(0, 3),
			dayOfMonth: date.getUTCDate(),
			today: day === today,
			past: day < today,
			picked: day === picked,
		}
	})
	return {
		range: formatWeekRange(weekStart, today),
		strip,
		/** Over the day's heading: "Today", or the weekday. */
		label: picked === today ? 'Today' : formatWeekdayName(pickedDate),
		weekdayName: formatWeekdayName(pickedDate),
		heading: formatMonthDay(pickedDate),
		/** Another week than today's: the app shows "This week" over the day. */
		otherWeek:
			serializeDate(weekStart) !==
			serializeDate(getWeekStart(parseDate(today))),
	}
}

/** The first Saturday after `today`, a `yyyy-MM-dd`. */
export function nextSaturday(today: string) {
	const date = parseDate(today)
	// getUTCDay(): 0 is Sunday, 6 Saturday.
	const ahead = (6 - date.getUTCDay() + 7) % 7 || 7
	return serializeDate(addDaysUTC(date, ahead))
}
