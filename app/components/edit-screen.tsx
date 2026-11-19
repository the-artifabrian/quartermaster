import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { CLIENT_LEAVES_FIELD } from '#app/utils/edit-screen.ts'
import { type LeaveTarget } from '#app/utils/nav-back.ts'
import {
	BACK_TO_LIST,
	markBackButtonPop,
	takeBackButtonPop,
} from '#app/utils/nav-direction.ts'
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
	const [leaving, setLeaving] = useState(false)
	useEffect(
		() => () => {
			leavingDone = false
		},
		[],
	)
	const leave = (target: LeaveTarget) => {
		leavingDone = true
		setLeaving(true)
		const replace = (to: string) =>
			navigate(to, { replace: true, state: BACK_TO_LIST, viewTransition: true })
		if (target.type === 'replace') {
			void replace(target.to)
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

/** The form's values as a string, for telling whether anything changed. */
function formSnapshot(form: HTMLFormElement) {
	const parts: string[] = []
	for (const [name, value] of new FormData(form)) {
		// Rendered after hydration, so it is missing from the first snapshot.
		if (name === CLIENT_LEAVES_FIELD) continue
		parts.push(
			`${name}=${typeof value === 'string' ? value : `file:${value.name}:${value.size}`}`,
		)
	}
	return JSON.stringify(parts)
}

/**
 * Asks before leaving an edit form with changes: by Cancel, the edge swipe
 * or browser back, or a link. The form is compared with what it showed
 * once mounted, so a form nobody touched never asks. Keep Editing stays with
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
		if (form instanceof HTMLFormElement) loaded.current = formSnapshot(form)
	}, [formId])

	const blocker = useBlocker(({ currentLocation, nextLocation }) => {
		if (leavingDone) return false
		// A Save submits to the page itself.
		if (currentLocation.pathname === nextLocation.pathname) return false
		const form = document.getElementById(formId)
		if (!(form instanceof HTMLFormElement) || loaded.current === null) {
			return false
		}
		return formSnapshot(form) !== loaded.current
	})

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
