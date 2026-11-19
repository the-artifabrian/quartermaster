import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useBlocker, useLocation, useNavigate } from 'react-router'
import { CLIENT_LEAVES_FIELD } from '#app/utils/edit-screen.ts'
import { type LeaveTarget } from '#app/utils/nav-back.ts'
import {
	BACK_TO_LIST,
	isViaTabBar,
	markBackButtonPop,
	takeBackButtonPop,
	VIA_TAB_BAR,
} from '#app/utils/nav-direction.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useLockNavBar } from './nav-bar.tsx'
import { ConfirmSheet } from './ui/confirm-sheet.tsx'

// An edit screen (Recipe and Menu, edit and new) hides the tab bar: Cancel
// and Save in the nav bar are the ways out. Save and Delete leave as if the
// screen was dismissed, and any other way out asks first when the form has
// changes.

const subscribeNothing = () => () => {}

function useHydrated() {
	return useSyncExternalStore(
		subscribeNothing,
		() => true,
		() => false,
	)
}

/**
 * Inside the form a Save or Delete submits: tells the action this screen
 * leaves by itself (edit-screen.ts). Rendered once hydrated, so a page
 * without JavaScript gets the action's redirect.
 */
export function ClientLeavesField() {
	return useHydrated() ? (
		<input type="hidden" name={CLIENT_LEAVES_FIELD} value="1" />
	) : null
}

// Set while a Save or Delete leaves: the form still differs from what it
// loaded with, and that is not a reason to ask.
let leavingDone = false

/** Leaves after a Save or Delete went through (nav-back.ts resolveAfter*). */
export function useLeaveEditScreen() {
	const navigate = useNavigate()
	const location = useLocation()
	const isNativeShell = useIsNativeShell()
	const [leaving, setLeaving] = useState(false)
	// Cancel or Save tapped while it leaves would go back twice or post again.
	useLockNavBar(leaving)
	useEffect(
		() => () => {
			leavingDone = false
		},
		[],
	)
	const leave = (target: LeaveTarget) => {
		leavingDone = true
		setLeaving(true)
		// Slides back in the iOS app; elsewhere it opens at once, as a push does
		// (PushLink).
		const replace = (to: string, state: object = BACK_TO_LIST) =>
			navigate(to, {
				replace: true,
				state,
				viewTransition: isNativeShell || undefined,
			})
		if (target.type === 'replace') {
			// An edit screen the tab bar restored hands the restore on to the
			// page that takes its place, as Cancel does.
			void replace(
				target.to,
				isViaTabBar(location.state)
					? { ...BACK_TO_LIST, ...VIA_TAB_BAR }
					: BACK_TO_LIST,
			)
			return
		}
		if (target.type === 'pop-replace') {
			// The router starts loading the popped-to entry (a page now gone)
			// on this popstate; opening the list in its place right after
			// cancels that load before it can show the page's error.
			const to = target.to
			window.addEventListener('popstate', () => void replace(to), {
				once: true,
			})
		} else {
			// Slides back as the nav bar's Back does.
			markBackButtonPop()
		}
		void navigate(-target.delta)
	}
	return { leaving, leave }
}

// One entry per submitted value, as FormData lists them. Textareas keep
// their line breaks either way, so both sides compare on \n.
function entry(name: string, value: string) {
	return `${name}=${value.replace(/\r\n/g, '\n')}`
}

/** The form's values as a string, for telling whether anything changed. */
function formSnapshot(form: HTMLFormElement) {
	const parts: string[] = []
	for (const [name, value] of new FormData(form)) {
		// Rendered after hydration, so it is missing from the first snapshot.
		if (name === CLIENT_LEAVES_FIELD) continue
		parts.push(
			typeof value === 'string'
				? entry(name, value)
				: `${name}=file:${value.name}:${value.size}`,
		)
	}
	return JSON.stringify(parts)
}

/**
 * The same, from what the page rendered (each field's default), not what
 * the fields hold now. A back to the edit screen that loads it again lets
 * the browser put typed text back into the fields before the page reads
 * them; those edits must still count as changes.
 */
function renderedSnapshot(form: HTMLFormElement) {
	const parts: string[] = []
	for (const element of Array.from(form.elements)) {
		if (!(
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement
		)) {
			continue
		}
		const { name } = element
		if (!name || element.disabled || name === CLIENT_LEAVES_FIELD) continue
		if (element instanceof HTMLSelectElement) {
			for (const option of Array.from(element.options)) {
				if (option.defaultSelected) parts.push(entry(name, option.value))
			}
			continue
		}
		if (element instanceof HTMLTextAreaElement) {
			parts.push(entry(name, element.defaultValue))
			continue
		}
		const type = element.type
		if (['submit', 'button', 'image', 'reset'].includes(type)) continue
		if (type === 'checkbox' || type === 'radio') {
			if (element.defaultChecked) parts.push(entry(name, element.value))
			continue
		}
		if (type === 'file') {
			parts.push(`${name}=file::0`)
			continue
		}
		parts.push(entry(name, element.defaultValue))
	}
	return JSON.stringify(parts)
}

/**
 * Asks before leaving an edit form with changes: by Cancel, the edge swipe
 * or browser back, or a link. The form is compared with what the page
 * rendered, so a form nobody touched never asks. Keep Editing stays with
 * the edits; Discard Changes goes where the user was going.
 */
export function DiscardChangesGuard({
	formId,
	description,
}: {
	formId: string
	/** One line on what is lost. */
	description: string
}) {
	const loaded = useRef<string | null>(null)
	useEffect(() => {
		const form = document.getElementById(formId)
		if (form instanceof HTMLFormElement) loaded.current = renderedSnapshot(form)
	}, [formId])

	const changed = () => {
		const form = document.getElementById(formId)
		if (!(form instanceof HTMLFormElement) || loaded.current === null) {
			return false
		}
		return formSnapshot(form) !== loaded.current
	}

	const blocker = useBlocker(({ currentLocation, nextLocation }) => {
		if (leavingDone) return false
		// A Save submits to the page itself.
		if (currentLocation.pathname === nextLocation.pathname) return false
		return changed()
	})

	// The router cannot hold a way out that leaves the document: a reload, a
	// closed tab, or history back to an entry from before a reload. The
	// browser asks there instead (desktop, Safari). The iOS app's WKWebView
	// shows no such prompt, so there it leaves without asking.
	useEffect(() => {
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (leavingDone || !changed()) return
			event.preventDefault()
			// Older browsers ask only when returnValue is set.
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', onBeforeUnload)
		return () => window.removeEventListener('beforeunload', onBeforeUnload)
		// `changed` reads the form and the baseline at the time of leaving.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [formId])

	// Cancel marks its pop as the nav bar's Back before the router holds it.
	const backButton = useRef(false)
	const blocked = blocker.state === 'blocked'
	useEffect(() => {
		if (blocked) backButton.current = takeBackButtonPop()
	}, [blocked])

	return (
		<ConfirmSheet
			open={blocked}
			onCancel={() => blocker.reset?.()}
			onConfirm={() => {
				if (backButton.current) markBackButtonPop()
				blocker.proceed?.()
			}}
			title="Discard changes?"
			description={description}
			confirmLabel="Discard Changes"
			cancelLabel="Keep Editing"
		/>
	)
}
