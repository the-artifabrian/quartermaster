import { useEffect, useSyncExternalStore } from 'react'
import { useRevalidator } from 'react-router'
import { toast } from 'sonner'
import { invalidateServiceWorkerData } from '#app/components/service-worker-data-sync.tsx'
import { Toaster } from '#app/components/ui/sonner.tsx'
import { getHouseholdClientId } from '#app/utils/household-client.tsx'
import { haptic } from '#app/utils/shell-bridge.ts'
import {
	createUndoStore,
	type DeleteAnswer,
	type HideStyle,
	type UndoSnapshotState,
} from '#app/utils/undo-delete.ts'

/** How long Undo is on offer (ms). */
export const UNDO_MS = 5000
const UNDO_TOASTER_ID = 'undo'
const UNDO_ROUTE = '/resources/undo-delete'

const store = createUndoStore({ releaseMs: 3000, enterMs: 1500 })

/**
 * One Undo toast at a time, like iOS: a new delete dismisses the last one's
 * toast, ending its offer. Each delete has its own toast id: one reused id
 * would merge a new delete into a toast that is still leaving, and it would
 * leave with it.
 */
let current: { key: string; toastId: string } | null = null
let toastCount = 0

/** Refreshes the page's data after a delete or a restore (UndoToaster). */
let revalidate: (() => Promise<void>) | null = null

/**
 * The page's data after a write outside the router: the caches drop and the
 * page refreshes, without waiting for it.
 */
function refresh() {
	invalidateServiceWorkerData()
	void revalidate?.()
}

const NOTHING: UndoSnapshotState = { hidden: new Map(), entering: new Map() }

function useUndoState() {
	return useSyncExternalStore(store.subscribe, store.getSnapshot, () => NOTHING)
}

/** The rows a delete has taken while its toast is up, and how each left. */
export function useHiddenRows() {
	return useUndoState().hidden
}

/** Rows an Undo has just brought back, so they open rather than pop in. */
export function useEnteringRows() {
	return useUndoState().entering
}

type UndoVerb = 'delete' | 'remove' | 'clear'
const PAST: Record<UndoVerb, string> = {
	delete: 'deleted',
	remove: 'removed',
	clear: 'cleared',
}

const offline = () => navigator.onLine === false

type UndoRequest =
	| { intent: 'delete-shopping'; itemIds: string[]; checkedOnly?: boolean }
	| {
			intent: 'delete-meal'
			mealId: string
			removeShoppingContributions: boolean
	  }
	| { intent: 'delete-meal-item'; itemId: string }
	| { intent: 'remove-staple'; stapleId: string }

/** One JSON request to the Undo route; anything but a 2xx is a failure. */
async function post(body: Record<string, unknown>) {
	const response = await fetch(UNDO_ROUTE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify({ ...body, originClientId: getHouseholdClientId() }),
	})
	if (!response.ok) throw new Error(`Undo route answered ${response.status}`)
	return (await response.json()) as { status: string; token?: string }
}

type DeleteWithUndo = {
	/** One per thing deleted; a second tap of the same thing is ignored. */
	key: string
	hides: string[]
	style?: HideStyle
	/** The toast's text: "Deleted milk". */
	message: string
	/** What a failure names: "milk", "the Meal". */
	what: string
	verb?: UndoVerb
	request: UndoRequest
}

/**
 * Deletes at once with an Undo toast at the bottom. The rows go now; the
 * delete answers with a sealed snapshot, and Undo sends it back. The toast
 * lives in the root, so Undo still works from another tab.
 */
function deleteWithUndo({
	key,
	hides,
	style,
	message,
	what,
	verb = 'delete',
	request,
}: DeleteWithUndo) {
	haptic('medium')
	// A double tap: the first delete is still out, with its toast.
	if (current?.key === key && store.active(key)) return
	if (current) {
		toast.dismiss(current.toastId)
		store.close(current.key)
	}
	const toastId = `undo:${++toastCount}`
	current = { key, toastId }
	store.start({
		key,
		hides,
		style,
		del: async (): Promise<DeleteAnswer> => {
			const answer = await post(request)
			refresh()
			if (answer.status === 'deleted' && answer.token) {
				return { status: 'deleted', snapshot: answer.token }
			}
			if (answer.status === 'gone') return { status: 'gone' }
			throw new Error(`Unexpected answer: ${answer.status}`)
		},
		restore: async (token) => {
			const answer = await post({ intent: 'restore', token })
			refresh()
			if (answer.status === 'restored') return 'restored'
			if (answer.status === 'gone') return 'gone'
			throw new Error(`Unexpected answer: ${answer.status}`)
		},
		onDeleteFailed: () => {
			if (current?.key === key) toast.dismiss(toastId)
			toast.error(
				offline()
					? `You’re offline, so ${what} wasn’t ${PAST[verb]}.`
					: `Couldn’t ${verb} ${what}. Try again.`,
			)
		},
		onRestoreFailed: () =>
			toast.error(
				offline()
					? `You’re offline, so ${what} couldn’t come back.`
					: `Couldn’t bring back ${what}.`,
			),
		onRestoreGone: () =>
			toast.error(`Couldn’t bring back ${what}: it changed in the meantime.`),
	})
	toast(message, {
		id: toastId,
		toasterId: UNDO_TOASTER_ID,
		duration: UNDO_MS,
		// Sage text, 44px tall for the thumb, as iOS shows Undo. Sonner's own
		// styles win without !important.
		classNames: {
			actionButton:
				'!bg-transparent !text-primary !-my-2 !-mr-2 !h-11 !px-3 !text-sm !font-semibold',
		},
		action: {
			label: 'Undo',
			onClick: () => {
				if (store.undo(key)) haptic('selection')
				// Sonner closes the toast without telling onDismiss: the offer
				// ends here.
				closed(key)
			},
		},
		onAutoClose: () => closed(key),
		onDismiss: () => closed(key),
	})
}

function closed(key: string) {
	if (current?.key === key) current = null
	store.close(key)
}

export function useDeleteWithUndo() {
	return deleteWithUndo
}

/**
 * A sheet opening means the person has moved on: the Undo toast goes rather
 * than sit over the sheet's controls, out of the sheet's reach for the
 * keyboard and VoiceOver. The delete has already happened.
 */
export function closeUndoForSheet() {
	if (current) toast.dismiss(current.toastId)
}

/**
 * Where Undo toasts show: at the bottom, above the tab bar, near the thumb
 * that deleted (tailwind.css, "Undo toasts"). Every other toast stays at the
 * top.
 */
export function UndoToaster({ theme }: { theme?: 'light' | 'dark' }) {
	const revalidator = useRevalidator()
	useEffect(() => {
		revalidate = revalidator.revalidate
		return () => {
			revalidate = null
		}
	}, [revalidator.revalidate])
	return (
		<Toaster
			id={UNDO_TOASTER_ID}
			// `toaster group` keeps the shared toast styles (ui/sonner.tsx).
			className="toaster group undo-toaster"
			position="bottom-center"
			theme={theme}
			visibleToasts={1}
			offset={{ bottom: 'var(--undo-toast-bottom)' }}
			mobileOffset={{
				bottom: 'var(--undo-toast-bottom)',
				left: '16px',
				right: 'var(--undo-toast-right)',
			}}
		/>
	)
}
