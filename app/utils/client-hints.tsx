/**
 * This file contains utilities for using client hints for user preference which
 * are needed by the server, but are only known by the browser.
 */
import { getHintUtils } from '@epic-web/client-hints'
import {
	clientHint as colorSchemeHint,
	subscribeToSchemeChange,
} from '@epic-web/client-hints/color-scheme'
import { clientHint as timeZoneHint } from '@epic-web/client-hints/time-zone'
import * as React from 'react'
import { useRevalidator } from 'react-router'
import { todayInTimeZone } from './date.ts'
import { useOptionalRequestInfo, useRequestInfo } from './request-info.ts'
import { themeCookieName } from './theme-cookie.ts'

const hintsUtils = getHintUtils({
	theme: colorSchemeHint,
	timeZone: timeZoneHint,
	// add other hints here
})

export const { getHints } = hintsUtils

/**
 * @returns an object with the client hints and their values
 */
export function useHints() {
	const requestInfo = useRequestInfo()
	return requestInfo.hints
}

/**
 * Whether the server drew the page from other hints than the browser has
 * stored: a day other than the stored time zone gives, or a theme other than
 * the chosen one or, with none chosen, the stored system scheme. Only a hint
 * the browser has stored counts, since a load before that would read the
 * same fallback. The time zone counts by the day it gives, since today is
 * all the server reads from it. The cookies are read as the hint check
 * writes them, encoded.
 */
export function serverMissedAHint(
	page: { timeZone: string; theme: 'light' | 'dark' },
	browser: { timeZone: string; scheme: 'light' | 'dark' },
	cookieHeader: string,
) {
	const cookies = new Map(
		cookieHeader
			.split(';')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const at = part.indexOf('=')
				return [part.slice(0, at), part.slice(at + 1)] as const
			}),
	)
	const stored = (name: string, value: string) =>
		cookies.get(encodeURIComponent(name)) === encodeURIComponent(value)

	const dayMissed =
		stored(timeZoneHint.cookieName, browser.timeZone) &&
		todayInTimeZone(page.timeZone) !== todayInTimeZone(browser.timeZone)

	const chosen = cookies.get(themeCookieName)
	const theme =
		chosen === 'light' || chosen === 'dark'
			? chosen
			: stored(colorSchemeHint.cookieName, browser.scheme)
				? browser.scheme
				: null
	const themeMissed = theme !== null && theme !== page.theme

	return dayMissed || themeMissed
}

export function useOptionalHints() {
	const requestInfo = useOptionalRequestInfo()
	return requestInfo?.hints
}

/**
 * @returns inline script element that checks for client hints and sets cookies
 * if they are not set then reloads the page if any cookie was set to an
 * inaccurate value.
 */
export function ClientHintCheck({ nonce }: { nonce: string }) {
	const { revalidate } = useRevalidator()
	const requestInfo = useOptionalRequestInfo()
	const pageTimeZone = requestInfo?.hints.timeZone
	const pageTheme = requestInfo
		? (requestInfo.userPrefs.theme ?? requestInfo.hints.theme)
		: undefined
	React.useEffect(
		() => subscribeToSchemeChange(() => revalidate()),
		[revalidate],
	)
	// The script below reloads the page when a hint cookie was missing, but
	// Chromium can send that reload before it has stored the cookies the
	// script wrote, some or all of them. The server then draws the page with
	// its fallbacks (the day in UTC, a light theme), and the reloaded page,
	// which has the cookies by now, does not reload again. Load the data once
	// more when what the server drew differs from what the stored cookies
	// would give. Not offline, where the load would fail and replace the page.
	React.useEffect(() => {
		if (pageTimeZone === undefined || pageTheme === undefined) return
		if (navigator.onLine === false) return
		const browser = {
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			scheme: window.matchMedia('(prefers-color-scheme: dark)').matches
				? ('dark' as const)
				: ('light' as const),
		}
		if (
			serverMissedAHint(
				{ timeZone: pageTimeZone, theme: pageTheme },
				browser,
				document.cookie,
			)
		) {
			void revalidate()
		}
		// The hints are strings and revalidate keeps its identity, so this runs
		// again only when a load brings other hints: a server that keeps
		// missing them gets one more load, not a loop.
	}, [pageTimeZone, pageTheme, revalidate])

	return (
		<script
			nonce={nonce}
			dangerouslySetInnerHTML={{
				__html: hintsUtils.getClientHintCheckScript(),
			}}
		/>
	)
}
