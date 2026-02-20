import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Provides consistent modal keyboard behavior:
 * - Escape to close
 * - Focus trap (Tab cycles within modal)
 * - Focus restore on unmount (returns focus to previously focused element)
 * - Auto-focus first focusable element on mount (unless autoFocus already claimed)
 */
export function useModal(onClose: () => void) {
	const dialogRef = useRef<HTMLDivElement>(null)
	const previouslyFocusedRef = useRef<HTMLElement | null>(
		typeof document !== 'undefined'
			? (document.activeElement as HTMLElement | null)
			: null,
	)

	// Auto-focus first focusable element + restore focus on unmount
	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.contains(document.activeElement)) {
			const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
			first?.focus()
		}

		const previouslyFocused = previouslyFocusedRef.current
		return () => {
			previouslyFocused?.focus()
		}
	}, [])

	// Escape to close + focus trap
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				onClose()
				return
			}

			if (e.key === 'Tab') {
				const dialog = dialogRef.current
				if (!dialog) return
				const focusable = Array.from(
					dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
				)
				if (focusable.length === 0) return

				const first = focusable[0]!
				const last = focusable[focusable.length - 1]!

				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault()
					last.focus()
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault()
					first.focus()
				}
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [onClose])

	return dialogRef
}
