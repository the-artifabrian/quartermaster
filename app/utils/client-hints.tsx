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
	const serverTimeZone = useOptionalHints()?.timeZone
	React.useEffect(
		() => subscribeToSchemeChange(() => revalidate()),
		[revalidate],
	)
	// The script below reloads the page when a hint cookie was missing, but
	// Chromium can send that reload before it has stored every cookie the
	// script wrote. The server then draws the day in UTC, and the reloaded
	// page, which has the cookie by now, does not reload again. The zone only
	// sets today, so load the data once more when that makes today another
	// day, and the cookie holds the zone the server did not see.
	const checkedTimeZone = React.useRef(false)
	React.useEffect(() => {
		if (checkedTimeZone.current || serverTimeZone === undefined) return
		checkedTimeZone.current = true
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		const cookie = `${encodeURIComponent(timeZoneHint.cookieName)}=${encodeURIComponent(timeZone)}`
		if (
			todayInTimeZone(serverTimeZone) !== todayInTimeZone(timeZone) &&
			document.cookie.split('; ').includes(cookie)
		) {
			void revalidate()
		}
	}, [serverTimeZone, revalidate])

	return (
		<script
			nonce={nonce}
			dangerouslySetInnerHTML={{
				__html: hintsUtils.getClientHintCheckScript(),
			}}
		/>
	)
}
