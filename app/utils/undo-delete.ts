/**
 * Deletes with Undo: the delete is sent the moment it is tapped and answers
 * with a snapshot of what it removed; Undo sends the snapshot back and the
 * server puts it back (resources/undo-delete). Nothing doomed waits on the
 * server, so whatever anyone adds meanwhile lands on a list where the row is
 * already gone.
 *
 * This store is the page's side: which rows are hidden while a delete is out
 * and its toast is up, which are coming back from an Undo, and the order of
 * things when Undo is tapped before the delete has answered.
 */

/** How the rows a delete hides leave: collapsing, or at once (Clear checked). */
export type HideStyle = 'collapse' | 'instant'

export type DeleteAnswer =
	{ status: 'deleted'; snapshot: unknown } | { status: 'gone' }

export type UndoStoreJob = {
	key: string
	/** The ids of the rows the delete removes. */
	hides: string[]
	style?: HideStyle
	/** Sends the delete. A rejection shows the rows again. */
	del: () => Promise<DeleteAnswer>
	/** Sends the snapshot back. */
	restore: (snapshot: unknown) => Promise<'restored' | 'gone'>
	onDeleteFailed: () => void
	onRestoreFailed: () => void
	/** What the restore needed has gone meanwhile (a Meal deleted since). */
	onRestoreGone: () => void
}

type Job = UndoStoreJob & {
	state: 'deleting' | 'deleted' | 'gone' | 'restoring' | 'done'
	snapshot?: unknown
	undoAsked: boolean
	closed: boolean
}

export type UndoSnapshotState = {
	/** Rows a delete has taken, and how each left. */
	hidden: ReadonlyMap<string, HideStyle>
	/** Rows an Undo has just brought back, so they open rather than pop in. */
	entering: ReadonlyMap<string, HideStyle>
}

export function createUndoStore({
	releaseMs,
	enterMs,
}: {
	/**
	 * How long the rows stay hidden after the toast closes: the refreshed
	 * list that no longer has them can render a frame later.
	 */
	releaseMs: number
	/** How long a restored row counts as coming back. */
	enterMs: number
}) {
	const jobs = new Map<string, Job>()
	const entering = new Map<string, HideStyle>()
	const listeners = new Set<() => void>()
	let snapshot: UndoSnapshotState = { hidden: new Map(), entering: new Map() }

	function changed() {
		const hidden = new Map<string, HideStyle>()
		for (const job of jobs.values()) {
			if (job.state === 'done') continue
			for (const id of job.hides) hidden.set(id, job.style ?? 'collapse')
		}
		snapshot = { hidden, entering: new Map(entering) }
		for (const listener of listeners) listener()
	}

	function drop(job: Job) {
		if (jobs.get(job.key) !== job) return
		jobs.delete(job.key)
		changed()
	}

	function release(job: Job) {
		setTimeout(() => drop(job), releaseMs)
	}

	async function restore(job: Job) {
		job.state = 'restoring'
		let answer: 'restored' | 'gone'
		try {
			answer = await job.restore(job.snapshot)
		} catch {
			job.state = 'deleted'
			job.onRestoreFailed()
			release(job)
			return
		}
		if (answer === 'gone') {
			job.onRestoreGone()
			release(job)
			return
		}
		const style = job.style ?? 'collapse'
		for (const id of job.hides) entering.set(id, style)
		job.state = 'done'
		jobs.delete(job.key)
		changed()
		setTimeout(() => {
			for (const id of job.hides) {
				if (entering.get(id) === style) entering.delete(id)
			}
			changed()
		}, enterMs)
	}

	return {
		start(input: UndoStoreJob) {
			const existing = jobs.get(input.key)
			// A double tap while the first is still out is the same delete; a
			// job whose toast has closed is over, and a new one replaces it.
			const over =
				!existing ||
				existing.closed ||
				existing.state === 'gone' ||
				existing.state === 'done'
			if (!over) return
			const job: Job = {
				...input,
				state: 'deleting',
				undoAsked: false,
				closed: false,
			}
			jobs.set(job.key, job)
			changed()
			job.del().then(
				(answer) => {
					if (answer.status === 'gone') {
						job.state = 'gone'
					} else {
						job.state = 'deleted'
						job.snapshot = answer.snapshot
						if (job.undoAsked) return void restore(job)
					}
					if (job.closed) release(job)
				},
				() => {
					job.state = 'done'
					drop(job)
					job.onDeleteFailed()
				},
			)
		},
		/** Undo: true when there is (or will be) something to put back. */
		undo(key: string) {
			const job = jobs.get(key)
			if (!job || job.closed || job.undoAsked) return false
			if (job.state === 'deleting') {
				job.undoAsked = true
				return true
			}
			if (job.state !== 'deleted') return false
			job.undoAsked = true
			void restore(job)
			return true
		},
		/** A delete of this thing is still out, or its Undo still offered. */
		active(key: string) {
			const job = jobs.get(key)
			return (
				!!job &&
				!job.closed &&
				(job.state === 'deleting' ||
					job.state === 'deleted' ||
					job.state === 'restoring')
			)
		},
		/** The toast has closed: Undo is over. */
		close(key: string) {
			const job = jobs.get(key)
			if (!job || job.closed) return
			job.closed = true
			if (job.state === 'deleted' || job.state === 'gone') release(job)
		},
		getSnapshot() {
			return snapshot
		},
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}

export type UndoStore = ReturnType<typeof createUndoStore>
