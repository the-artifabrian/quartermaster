import {
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react'
import { createPortal } from 'react-dom'
import { closeUndoForSheet } from '#app/components/undo-delete.tsx'
import { useSheetDrag } from '#app/hooks/use-sheet-drag.ts'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './icon.tsx'

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A sheet that leaves without an animation still unmounts after this. */
const EXIT_FALLBACK_MS = 500

/**
 * A phone: below `sm`, or on its side (a finger on a short screen). There a
 * sheet sits on the bottom edge and can be pulled down; elsewhere it is a
 * centered dialog. The `dialog:` variant in tailwind.css is the opposite.
 */
const SHEET_QUERY = '(width < 40rem), (pointer: coarse) and (height <= 500px)'

/**
 * Whether a picker or form opening now should be a bottom sheet: on a phone
 * (SHEET_QUERY). Wider screens keep their popover or inline panel. Read when
 * it opens, so the server and the first render agree; no `matchMedia` (jsdom)
 * means the wide UI.
 */
export function opensAsSheet() {
	if (typeof window === 'undefined' || !window.matchMedia) return false
	return window.matchMedia(SHEET_QUERY).matches
}

/** The sheet that is open now. Opening another closes it first. */
let openSheet: { close: () => void } | null = null

type BottomSheetProps = {
	open: boolean
	/** Backdrop tap, Escape, the close button and a pull down all call this. */
	onClose: () => void
	/** The id the title gets; the dialog is labelled by it. */
	labelledBy: string
	/** The serif title at the top left, beside the round Close button. */
	title: ReactNode
	/** One line under the title. */
	description?: ReactNode
	/**
	 * Takes focus when the sheet opens. Without it focus goes to whatever a
	 * child focused, else the first thing that can take it (Close).
	 */
	initialFocusRef?: RefObject<HTMLElement | null>
	/**
	 * Takes focus back once the sheet is gone, for a sheet opened from a menu
	 * item that is gone by then. Without it focus goes back to what had it.
	 */
	returnFocusRef?: RefObject<HTMLElement | null>
	/** Classes for the panel. */
	className?: string
	/** Classes for the part under the header, which scrolls. */
	bodyClassName?: string
	children: ReactNode
}

/**
 * The phone's bottom sheet, one anatomy for every sheet: a grabber, a serif
 * title with an optional line under it, and a round Close button. It covers
 * the tab bar over a dimmed page; off a phone (SHEET_QUERY) it is a centered
 * dialog. The panel slides up from below on open and leaves the same way on
 * close while the backdrop fades (tailwind.css, "Bottom sheets"). It stays
 * mounted until its exit has run, then unmounts and gives focus back to
 * whatever had it before the sheet opened, unless focus has moved on since.
 *
 * It renders on `<body>`, so nothing around its owner (a hidden layout, a
 * row's `inert` or transform, a form) reaches it. If its owner goes away
 * while it is open (a row deleted elsewhere, a Meal moved to another day), a
 * copy of it still plays the exit.
 *
 * While open it is modal to the keyboard: Escape closes it and Tab cycles
 * within it. On a phone it can also be pulled down to close (useSheetDrag).
 */
export function BottomSheet({ open, ...props }: BottomSheetProps) {
	const [rendered, setRendered] = useState(open)
	if (open && !rendered) setRendered(true)
	if (!rendered) return null
	return (
		<SheetFrame {...props} open={open} onExited={() => setRendered(false)} />
	)
}

function SheetFrame({
	open,
	onClose,
	onExited,
	labelledBy,
	title,
	description,
	initialFocusRef,
	returnFocusRef,
	className,
	bodyClassName,
	children,
}: BottomSheetProps & { onExited: () => void }) {
	const rootRef = useRef<HTMLDivElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const backdropRef = useRef<HTMLDivElement>(null)
	// Read while the trigger still has focus, before this sheet takes it.
	const previouslyFocusedRef = useRef<HTMLElement | null>(
		typeof document !== 'undefined'
			? (document.activeElement as HTMLElement | null)
			: null,
	)
	const onCloseRef = useRef(onClose)
	const onExitedRef = useRef(onExited)
	useEffect(() => {
		onCloseRef.current = onClose
		onExitedRef.current = onExited
	})
	const [self] = useState(() => ({ close: () => onCloseRef.current() }))

	useSheetDrag({
		open,
		// A centered dialog has no edge to pull it toward.
		enabled: () => window.matchMedia(SHEET_QUERY).matches,
		panelRef,
		backdropRef,
		onDismiss: () => onCloseRef.current(),
	})

	// Take focus on each open unless a child claimed it. A reopen during the
	// exit keeps this instance, so it takes focus again and remembers where
	// focus was then.
	const mountedRef = useRef(false)
	useEffect(() => {
		if (!open) return
		const panel = panelRef.current
		if (!panel) return
		const active = document.activeElement as HTMLElement | null
		if (
			mountedRef.current &&
			active &&
			active !== document.body &&
			!panel.contains(active)
		) {
			previouslyFocusedRef.current = active
		}
		mountedRef.current = true
		// The panel is still below the screen as it starts to slide up.
		const initial = initialFocusRef?.current
		if (initial && panel.contains(initial)) {
			initial.focus({ preventScroll: true })
		} else if (!panel.contains(active)) {
			panel
				.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
				?.focus({ preventScroll: true })
		}
	}, [open, initialFocusRef])

	// Give focus back once the sheet is gone, unless another sheet has opened
	// since (focus belongs in that one) or focus has moved on during the exit,
	// such as to another row's menu.
	const returnFocusRefRef = useRef(returnFocusRef)
	useEffect(() => {
		const root = rootRef.current
		return () => {
			const active = document.activeElement
			const focusMovedOn =
				active != null && active !== document.body && !root?.contains(active)
			const previouslyFocused =
				returnFocusRefRef.current?.current ?? previouslyFocusedRef.current
			if (
				openSheet === null &&
				!focusMovedOn &&
				previouslyFocused?.isConnected
			) {
				previouslyFocused.focus({ preventScroll: true })
			}
		}
	}, [])

	// An owner that goes away while the sheet is open takes it along at once.
	// A copy, inert, plays the exit in its place.
	const openRef = useRef(open)
	useLayoutEffect(() => {
		openRef.current = open
	})
	useLayoutEffect(() => {
		const root = rootRef.current
		return () => {
			if (!openRef.current || !root?.isConnected) return
			playExitCopy(root)
		}
	}, [])

	useEffect(() => {
		if (!open) return
		// An Undo toast would sit over the sheet's controls: it goes.
		closeUndoForSheet()
		const other = openSheet
		openSheet = self
		if (other && other !== self) other.close()
		return () => {
			if (openSheet === self) openSheet = null
		}
	}, [open, self])

	// Escape and the focus trap belong to the open sheet only, not to one
	// that is leaving.
	useEffect(() => {
		if (!open) return
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				onCloseRef.current()
				return
			}
			if (event.key !== 'Tab') return
			const panel = panelRef.current
			if (!panel) return
			// A tap on a part of the panel that takes no focus focuses the panel.
			if (document.activeElement === panel) {
				const focusable =
					panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
				const target = event.shiftKey
					? focusable[focusable.length - 1]
					: focusable[0]
				if (target) {
					event.preventDefault()
					target.focus()
				}
				return
			}
			const focusable = Array.from(
				panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			)
			const first = focusable[0]
			const last = focusable.at(-1)
			if (!first || !last) return
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault()
				first.focus()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [open])

	// Unmount once the exit transitions have run. Reopening cancels them, and
	// the sheet stays.
	useEffect(() => {
		if (open) return
		let done = false
		const finish = () => {
			if (done) return
			done = true
			onExitedRef.current()
		}
		// getAnimations flushes style, so it sees the transitions the closed
		// state has just started.
		// An endless animation inside (a spinner, a pulsing mic) never finishes.
		const animations = (
			rootRef.current?.getAnimations?.({ subtree: true }) ?? []
		).filter(
			(animation) => animation.effect?.getTiming().iterations !== Infinity,
		)
		const fallback = window.setTimeout(finish, EXIT_FALLBACK_MS)
		void Promise.allSettled(animations.map((a) => a.finished)).then(finish)
		return () => {
			done = true
			window.clearTimeout(fallback)
		}
	}, [open])

	const state = open ? 'open' : 'closed'
	const descriptionId = `${labelledBy}-description`

	const frame = (
		<div
			ref={rootRef}
			data-bottom-sheet=""
			data-state={state}
			className="dialog:items-center dialog:p-4 fixed inset-0 z-60 flex items-end justify-center"
		>
			<div
				ref={backdropRef}
				data-bottom-sheet-backdrop=""
				data-state={state}
				className="absolute inset-0 bg-black/40"
				onClick={() => onCloseRef.current()}
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				// Taps on its text keep focus in the sheet, not on the page.
				tabIndex={-1}
				aria-labelledby={labelledBy}
				aria-describedby={description != null ? descriptionId : undefined}
				data-bottom-sheet-panel=""
				data-state={state}
				className={cn(
					// Never taller than the screen under the status bar.
					'bg-card shadow-warm-lg dialog:max-h-[85dvh] dialog:rounded-xl relative flex max-h-[calc(100dvh-var(--safe-top)-1rem)] w-full max-w-md flex-col rounded-t-2xl outline-none',
					className,
				)}
			>
				{/* The handle a pull down closes the sheet by. A pull anywhere
				    on the sheet does the same, so it is only a cue. */}
				<div
					aria-hidden
					data-bottom-sheet-grabber=""
					className="bg-muted-foreground/30 dialog:hidden mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full"
				/>
				<div className="dialog:pt-4 flex shrink-0 items-start gap-3 px-5 pt-2 pb-3">
					{/* pt-2 sets the title's first line level with the 44px Close. */}
					<div className="min-w-0 flex-1 pt-2">
						<h2 id={labelledBy} className="font-serif text-xl leading-7">
							{title}
						</h2>
						{description != null && (
							<p
								id={descriptionId}
								className="text-muted-foreground mt-0.5 text-sm"
							>
								{description}
							</p>
						)}
					</div>
					<BottomSheetClose onClose={() => onCloseRef.current()} />
				</div>
				<div
					className={cn(
						// Clears the home indicator on a phone.
						'dialog:pb-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+var(--safe-bottom))]',
						bodyClassName,
					)}
				>
					{children}
				</div>
			</div>
		</div>
	)
	// A sheet opens on a tap, after hydration; the server never renders one.
	return typeof document === 'undefined'
		? frame
		: createPortal(frame, document.body)
}

/**
 * Plays a sheet's exit on an inert copy of it, for a sheet whose owner went
 * away while it was open. The copy starts where the sheet was, so its entry
 * (`@starting-style`) must not run first.
 */
function playExitCopy(root: HTMLElement) {
	const copy = root.cloneNode(true) as HTMLElement
	copy.inert = true
	copy.setAttribute('aria-hidden', 'true')
	for (const element of copy.querySelectorAll('[id]'))
		element.removeAttribute('id')
	const parts = [copy, ...copy.querySelectorAll<HTMLElement>('[data-state]')]
	for (const part of parts) {
		// From where it rests, even if a pull had moved it.
		part.style.removeProperty('transform')
		part.style.removeProperty('opacity')
		part.style.transition = 'none'
	}
	document.body.append(copy)
	copy.getBoundingClientRect()
	for (const part of parts) part.style.removeProperty('transition')
	copy.getBoundingClientRect()
	for (const part of parts) part.setAttribute('data-state', 'closed')
	window.setTimeout(() => copy.remove(), EXIT_FALLBACK_MS)
}

function BottomSheetClose({ onClose }: { onClose: () => void }) {
	return (
		<button
			type="button"
			onClick={onClose}
			// A 44pt target around a smaller round button.
			className="group/close -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full"
			aria-label="Close"
		>
			<span className="bg-muted text-muted-foreground group-hover/close:text-foreground flex size-8 items-center justify-center rounded-full transition-colors group-active/close:scale-95">
				<Icon name="cross-1" className="size-3.5" />
			</span>
		</button>
	)
}
