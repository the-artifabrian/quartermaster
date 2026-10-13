import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '#app/utils/misc.tsx'
import { Icon } from './icon.tsx'

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A sheet that leaves without an animation still unmounts after this. */
const EXIT_FALLBACK_MS = 500

/** The sheet that is open now. Opening another closes it first. */
let openSheet: { close: () => void } | null = null

type BottomSheetProps = {
	open: boolean
	/** Backdrop tap, Escape and the close button all call this. */
	onClose: () => void
	/** The id of the sheet's title. */
	labelledBy: string
	/**
	 * Renders the standard header: this title and a Close button. Leave it out
	 * when the content brings its own heading (with `labelledBy` as its id) and
	 * its own way to close.
	 */
	title?: ReactNode
	/**
	 * `docked` sits on the tab bar. `modal` covers the tab bar on a phone and
	 * is a centered dialog from `sm` up.
	 */
	layout?: 'docked' | 'modal'
	/** Classes for the panel. */
	className?: string
	children: ReactNode
}

/**
 * The phone's bottom sheet. The panel slides up from below on open and leaves
 * the same way on close while the backdrop fades (tailwind.css, "Bottom
 * sheets"). It stays mounted until its exit has run, then unmounts and gives
 * focus back to whatever had it before the sheet opened.
 *
 * While open it is modal to the keyboard: Escape closes it and Tab cycles
 * within it.
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
	layout = 'docked',
	className,
	children,
}: BottomSheetProps & { onExited: () => void }) {
	const rootRef = useRef<HTMLDivElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
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
		if (!panel.contains(active)) {
			panel
				.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
				// The panel is still below the screen as it starts to slide up.
				?.focus({ preventScroll: true })
		}
	}, [open])

	// Give focus back once the sheet is gone, unless another sheet has opened
	// since: focus belongs in that one.
	useEffect(
		() => () => {
			const previouslyFocused = previouslyFocusedRef.current
			if (openSheet === null && previouslyFocused?.isConnected) {
				previouslyFocused.focus({ preventScroll: true })
			}
		},
		[],
	)

	useEffect(() => {
		if (!open) return
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

	return (
		<div
			ref={rootRef}
			data-bottom-sheet={layout}
			data-state={state}
			className={cn(
				layout === 'modal' &&
					'fixed inset-0 z-60 flex items-end justify-center sm:items-center',
			)}
		>
			<div
				data-bottom-sheet-backdrop=""
				data-state={state}
				className={cn(
					layout === 'modal'
						? 'absolute inset-0 bg-black/50 backdrop-blur-sm'
						: 'fixed inset-0 z-40 bg-black/15',
				)}
				onClick={() => onCloseRef.current()}
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={labelledBy}
				data-bottom-sheet-panel=""
				data-state={state}
				className={cn(
					'bg-card shadow-warm-lg overflow-y-auto overscroll-contain',
					layout === 'modal'
						? // Over the tab bar on a phone, so it clears the home indicator.
							'relative max-h-[85dvh] w-full max-w-md rounded-t-xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-xl sm:pb-6'
						: // On the tab bar, and never taller than the screen above it.
							'border-border/60 fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+var(--bottom-nav-inset))] z-50 max-h-[calc(100dvh-var(--bottom-nav-h)-var(--bottom-nav-inset)-env(safe-area-inset-top)-2.5rem)] rounded-t-xl border-t p-4',
					className,
				)}
			>
				{title != null && (
					<div className="mb-2 flex items-center justify-between">
						<span id={labelledBy} className="text-sm font-medium">
							{title}
						</span>
						<BottomSheetClose onClose={() => onCloseRef.current()} />
					</div>
				)}
				{children}
			</div>
		</div>
	)
}

function BottomSheetClose({ onClose }: { onClose: () => void }) {
	return (
		<button
			type="button"
			onClick={onClose}
			// A 44pt target that takes no more height than the title's line.
			className="text-muted-foreground hover:text-foreground -my-3 -mr-3 flex size-11 items-center justify-center rounded-md"
			aria-label="Close"
		>
			<Icon name="cross-1" size="sm" />
		</button>
	)
}
