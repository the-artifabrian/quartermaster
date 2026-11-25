import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import {
	Link,
	type Params,
	useLocation,
	useMatches,
	useNavigate,
	useNavigation,
	useNavigationType,
} from 'react-router'
import { cn } from '#app/utils/misc.tsx'
import {
	getHistoryLog,
	getServerHistoryLog,
	type NavRule,
	recordHistory,
	resolveBack,
	subscribeHistoryLog,
} from '#app/utils/nav-back.ts'
import {
	BACK_TO_LIST,
	historyIndex,
	isViaTabBar,
	markBackButtonPop,
	VIA_TAB_BAR,
} from '#app/utils/nav-direction.ts'
import { isNormalLinkActivation } from './bottom-nav.tsx'
import { Icon } from './ui/icon.tsx'

/**
 * A pushed page declares its nav bar in its route `handle`: the rule for
 * Back (nav-back.ts) and, on an edit screen, the id of the form the bar's
 * Save submits. Tab roots declare nothing and keep the brand header.
 */
export type NavBarHandle = {
	nav: NavRule | ((match: { params: Params }) => NavRule)
	/** Edit screens: Cancel replaces Back, and Save submits this form. */
	navForm?: string
}

export type NavBarConfig = {
	rule: NavRule
	form?: string
	/** The route's loader returned its data, so it renders its page (and
	 * form), not its error. */
	loaded?: boolean
}

function readNavHandle(handle: unknown): NavBarHandle | null {
	if (typeof handle !== 'object' || handle === null) return null
	return 'nav' in handle ? (handle as NavBarHandle) : null
}

/** The deepest route's nav bar, or null on a tab root. */
export function useNavBarConfig(): NavBarConfig | null {
	const matches = useMatches()
	for (let i = matches.length - 1; i >= 0; i--) {
		const match = matches[i]!
		const handle = readNavHandle(match.handle)
		if (!handle) continue
		const rule =
			typeof handle.nav === 'function'
				? handle.nav({ params: match.params })
				: handle.nav
		return {
			rule,
			form: handle.navForm,
			loaded: match.loaderData !== undefined,
		}
	}
	return null
}

/** Logs each history entry the app shows, so Back knows what is behind it. */
export function useRecordHistory() {
	const location = useLocation()
	const action = useNavigationType()
	useLayoutEffect(() => {
		const idx = historyIndex()
		if (idx === null) return
		recordHistory({
			idx,
			pathname: location.pathname,
			search: location.search,
			viaTabBar: isViaTabBar(location.state),
			action,
		})
	}, [location.key, location.pathname, location.search, location.state, action])
}

// An edit form registers with the bar while it is on screen: the bar shows
// Cancel and Save only then (not over the route's error page), and the form
// can hold Save back while it is not ready to send (a photo still being
// shrunk), as a submit button in the form would.
const mountedForms = new Map<string, number>()
let saveBlocked = false
const formListeners = new Set<() => void>()

function notifyForms() {
	for (const listener of formListeners) listener()
}

function subscribeForms(listener: () => void) {
	formListeners.add(listener)
	return () => {
		formListeners.delete(listener)
	}
}

// While an edit screen leaves after Save or Delete, or a Delete is on its way,
// Cancel and Save do nothing: they would go back twice, or post to a Recipe
// that is gone.
let barLocks = 0

/** Holds the bar's Cancel/Back and Save while `locked`. */
export function useLockNavBar(locked: boolean) {
	useEffect(() => {
		if (!locked) return
		barLocks++
		notifyForms()
		return () => {
			barLocks--
			notifyForms()
		}
	}, [locked])
}

/** Called by an edit form whose id a route handle names as `navForm`. */
export function useNavBarForm(formId: string, { blocked = false } = {}) {
	// A layout effect, so a client navigation paints Save with the form.
	useLayoutEffect(() => {
		mountedForms.set(formId, (mountedForms.get(formId) ?? 0) + 1)
		notifyForms()
		return () => {
			const count = (mountedForms.get(formId) ?? 1) - 1
			if (count > 0) mountedForms.set(formId, count)
			else mountedForms.delete(formId)
			notifyForms()
		}
	}, [formId])
	useEffect(() => {
		saveBlocked = blocked
		notifyForms()
		return () => {
			saveBlocked = false
			notifyForms()
		}
	}, [blocked])
}

/**
 * The bar's Save comes first in the page, so it is the form's default button
 * and Return in any field would save and leave. Return in an ingredient, a
 * step or a Menu builder row does nothing. The title keeps what it did when
 * the form ended in its own Save (`titleSaves`): a Recipe's or a new Menu's
 * saves; a Menu builder's did nothing, its first default button being a
 * disabled Move up.
 */
export function keepReturnFromSaving(
	event: ReactKeyboardEvent<HTMLFormElement>,
	{ titleSaves }: { titleSaves: boolean },
) {
	if (event.key !== 'Enter' || event.defaultPrevented) return
	const target = event.target
	if (!(target instanceof HTMLInputElement)) return
	if (titleSaves && target.name === 'title') return
	event.preventDefault()
}

/**
 * The page's big serif title (its h1) and whether it has scrolled up under
 * the bar. The bar shows the title small once it has.
 */
function useTitleUnderBar(barRef: React.RefObject<HTMLElement | null>) {
	const { pathname } = useLocation()
	const [state, setState] = useState({ pathname: '', title: '', under: false })
	useEffect(() => {
		const bar = barRef.current
		if (!bar) return
		// A page without an h1 (an error page) still has its bar measured.
		const heading = document.querySelector('#main-content h1')
		let observer: IntersectionObserver | null = null
		const observe = () => {
			observer?.disconnect()
			// rootMargin takes pixels only: the bar's bottom edge, status bar
			// included in the iOS app. On a desktop a page that is not an edit
			// screen hides the bar, and the sticky header above it is what
			// content must clear.
			const edge = bar.getClientRects().length > 0 ? bar : bar.parentElement
			const barBottom = Math.max(
				0,
				Math.round((edge ?? bar).getBoundingClientRect().bottom),
			)
			// tailwind.css keeps focused and scrolled-to fields clear of the bar.
			document.documentElement.style.setProperty(
				'--nav-bar-bottom',
				`${barBottom}px`,
			)
			if (!heading) return
			observer = new IntersectionObserver(
				([entry]) => {
					if (!entry) return
					setState({
						pathname,
						title: heading.textContent?.trim() ?? '',
						under:
							!entry.isIntersecting && entry.boundingClientRect.top < barBottom,
					})
				},
				{ rootMargin: `-${barBottom}px 0px 0px 0px`, threshold: 0 },
			)
			observer.observe(heading)
		}
		observe()
		const resize = new ResizeObserver(observe)
		resize.observe(bar)
		// The header holds the status bar inset above the bar in the iOS app.
		// Its padding, so the border box.
		if (bar.parentElement) {
			resize.observe(bar.parentElement, { box: 'border-box' })
		}
		return () => {
			observer?.disconnect()
			resize.disconnect()
			document.documentElement.style.removeProperty('--nav-bar-bottom')
		}
	}, [barRef, pathname])
	// The bar outlives the page: a reading taken on the page before (a
	// scrolled Recipe, before its Edit) does not show on this one. The same
	// page with a new search (a scaled Recipe) keeps it.
	return state.pathname === pathname ? state : { title: '', under: false }
}

/**
 * Whether the route's edit form is on screen: the bar shows Cancel and Save,
 * and the tab bar hides, only then. Until the form has reported, the route's
 * own state says: its page (and form) renders unless it failed to load. Once
 * it has, an error after load (a Delete that finds the Recipe gone) takes the
 * form away and with it the edit screen. A layout effect, subscribed before
 * the form's own layout effect reports, so a first frame never shows Back
 * where Cancel belongs.
 */
export function useEditFormOnScreen(form: string | undefined, loaded: boolean) {
	const [formMount, setFormMount] = useState<{
		form: string
		mounted: boolean
	} | null>(null)
	useLayoutEffect(() => {
		if (!form) return
		const sync = () => setFormMount({ form, mounted: mountedForms.has(form) })
		sync()
		return subscribeForms(sync)
	}, [form])
	if (!form) return false
	return formMount?.form === form ? formMount.mounted : loaded
}

const barTextButton =
	'text-primary flex min-h-11 items-center rounded-md px-2 text-[17px] leading-none transition-opacity active:opacity-60 md:text-base'

export function NavBar({ rule, form, loaded = true }: NavBarConfig) {
	const location = useLocation()
	const navigate = useNavigate()
	const navigation = useNavigation()
	const barRef = useRef<HTMLDivElement>(null)
	const { title, under } = useTitleUnderBar(barRef)
	const blocked = useSyncExternalStore(
		subscribeForms,
		() => saveBlocked,
		() => false,
	)
	const locked = useSyncExternalStore(
		subscribeForms,
		() => barLocks > 0,
		() => false,
	)
	const formOnScreen = useEditFormOnScreen(form, loaded)
	const editing = form && formOnScreen ? form : null
	const viaTabBar = isViaTabBar(location.state)
	// The history entry this page committed on. The browser's own index moves
	// as soon as a pop starts, while this page stays up until the next one has
	// loaded.
	const entry = useRef<{ key: string; idx: number | null } | null>(null)
	if (entry.current?.key !== location.key) {
		entry.current = { key: location.key, idx: historyIndex() }
	}
	const committedIdx = entry.current.idx
	// The server cannot see the history, so it and the first client render
	// label Back with the parent; the client re-renders with the log.
	const log = useSyncExternalStore(
		subscribeHistoryLog,
		getHistoryLog,
		getServerHistoryLog,
	)
	const label = resolveBack({
		idx: log === getServerHistoryLog() ? null : committedIdx,
		log,
		pathname: location.pathname,
		viaTabBar,
		rule,
	}).label

	const onBack = (event: ReactMouseEvent<HTMLAnchorElement>) => {
		if (locked) {
			event.preventDefault()
			return
		}
		if (!isNormalLinkActivation(event) || event.defaultPrevented) return
		// A second tap while the first pop is still loading would go back
		// again, or replace the page it is going to.
		if (historyIndex() !== committedIdx) {
			event.preventDefault()
			return
		}
		const target = resolveBack({
			idx: committedIdx,
			log: getHistoryLog(),
			pathname: location.pathname,
			viaTabBar,
			rule,
		})
		// A replace is the link's own navigation, to the parent.
		if (target.type !== 'pop') return
		event.preventDefault()
		markBackButtonPop()
		void navigate(-target.delta)
	}

	const saving =
		navigation.state !== 'idle' &&
		navigation.formMethod != null &&
		navigation.formAction?.split('?')[0] === location.pathname

	return (
		<div
			ref={barRef}
			data-nav-bar=""
			// The sides keep room for "‹ Shopping" and Save, so the title stays
			// centred on the bar and truncates before it reaches them. On a desktop
			// (wide, with a mouse) the header's own tab links and the browser's
			// Back do the bar's job, so only an edit screen keeps it, for Cancel
			// and Save. A sideways iPhone is as wide but has no browser Back.
			className={cn(
				'container grid h-11 grid-cols-[minmax(6.5rem,1fr)_minmax(0,auto)_minmax(6.5rem,1fr)] items-center gap-2 print:hidden',
				!editing && 'desktop:hidden',
			)}
		>
			<div className="flex min-w-0 justify-start">
				<Link
					to={rule.parent}
					replace
					// A page the tab bar restored hands the restore on to the page
					// that replaces it.
					state={viaTabBar ? { ...BACK_TO_LIST, ...VIA_TAB_BAR } : BACK_TO_LIST}
					viewTransition
					onClick={onBack}
					data-nav-back=""
					aria-label={editing ? undefined : `Back to ${label}`}
					aria-disabled={locked || undefined}
					className={cn(
						barTextButton,
						'max-w-full min-w-0 aria-disabled:opacity-40',
						editing ? '-ml-2' : '-ml-3 gap-0.5 pl-1',
					)}
				>
					{editing ? (
						'Cancel'
					) : (
						<>
							<Icon
								name="chevron-left"
								className="size-6 shrink-0"
								aria-hidden="true"
							/>
							<span className="truncate">{label}</span>
						</>
					)}
				</Link>
			</div>
			<span
				aria-hidden="true"
				data-nav-title={title}
				data-shown={under ? '' : undefined}
				// The text is generated content, so it does not repeat the h1 for
				// assistive tech or text search.
				className="text-foreground min-w-0 truncate text-[17px] font-semibold opacity-0 transition-opacity duration-150 ease-out before:content-[attr(data-nav-title)] data-shown:opacity-100 motion-reduce:transition-none md:max-w-md md:text-base"
			/>
			<div className="flex min-w-0 justify-end">
				{editing ? (
					<button
						type="submit"
						form={editing}
						disabled={saving || blocked || locked}
						aria-busy={saving || undefined}
						data-nav-save=""
						className={cn(
							barTextButton,
							'-mr-2 font-semibold disabled:opacity-40',
						)}
					>
						{saving ? (
							<>
								<Icon
									name="update"
									className="mr-1.5 size-4 animate-spin"
									aria-hidden="true"
								/>
								Saving
							</>
						) : (
							'Save'
						)}
					</button>
				) : null}
			</div>
		</div>
	)
}
