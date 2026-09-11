import { Worker } from 'node:worker_threads'

// Companion to server/memory-watchdog.ts, for the failure mode that watchdog
// is structurally unable to see.
//
// On 2026-09-11 CPU-bound work on the request path pinned the main thread in a
// loop that allocated nothing and made no syscalls. Memory, swap and disk
// stayed healthy, so the memory watchdog never breached — and it could not have
// acted anyway, because it samples from a `setInterval` on the very event loop
// that was wedged. Fly's health checks noticed within seconds but checks only
// stop routing, so the box sat at 503 for ninety minutes.
//
// A blocked event loop can only be observed from outside that loop. The main
// thread bumps a counter in a SharedArrayBuffer on a timer; a worker *thread* —
// its own OS thread, its own event loop, unaffected by the main thread
// spinning — watches that counter. When it stops advancing for long enough, the
// worker kills the whole process (same PID) and Fly's `on-failure` restart
// policy reboots us: a blip instead of a multi-hour outage.
//
// The decision is deliberately made on a COUNTER, not on wall-clock deltas. A
// timestamp heartbeat would let an NTP step larger than the stall threshold
// look exactly like a wedged loop, and this component's response to that is
// SIGKILL. A counter only ever answers "did the main thread make progress
// between two observations", which no clock adjustment can fake.
//
// Not a graceful exit, by design. The main thread is wedged, so nothing that
// has to run there — a shutdown handler, a PostHog flush — can complete. The
// worker logs the diagnosis to stdout (Fly captures it) and then SIGKILLs.

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000
const DEFAULT_CHECK_INTERVAL_MS = 5_000
// A block this long is never legitimate work. The two synchronous pauses this
// app takes on purpose — a forced `Bun.gc(true)` every 5 minutes and SSR of a
// large recipe — are sub-second, and Fly's HTTP check has already failed at ~7s
// and stopped routing long before we get here. Generous enough that a slow
// render on a throttled shared CPU can never trip it.
const DEFAULT_STALL_THRESHOLD_MS = 60_000
// Migrations, LiteFS sync, and the first renders all land in the first seconds
// after boot, where a long pause is expected rather than pathological.
const DEFAULT_GRACE_MS = 60_000

export type EventLoopWatchdogConfig = {
	heartbeatIntervalMs: number
	checkIntervalMs: number
	stallThresholdMs: number
	graceMs: number
}

function readEnvMs(name: string, fallback: number): number {
	const raw = process.env[name]
	if (!raw) return fallback
	const value = Number(raw)
	// Mirrors the BUN_GC_INTERVAL_MS / MEMORY_WATCHDOG_INTERVAL_MS contract: 0
	// disables, and any other unusable value falls back to the default rather
	// than silently disabling the mitigation. Never reaches setInterval, which
	// clamps fractional or >2^31-1 inputs to ~1ms.
	if (value === 0) return 0
	if (!(value >= 1 && value <= 2 ** 31 - 1)) {
		console.warn(`⚠️ Ignoring invalid ${name}=${raw}; using ${fallback}`)
		return fallback
	}
	return value
}

export function readEventLoopWatchdogConfig(): EventLoopWatchdogConfig {
	return {
		heartbeatIntervalMs: readEnvMs(
			'EVENT_LOOP_WATCHDOG_HEARTBEAT_MS',
			DEFAULT_HEARTBEAT_INTERVAL_MS,
		),
		checkIntervalMs: readEnvMs(
			'EVENT_LOOP_WATCHDOG_CHECK_MS',
			DEFAULT_CHECK_INTERVAL_MS,
		),
		stallThresholdMs: readEnvMs(
			'EVENT_LOOP_WATCHDOG_STALL_MS',
			DEFAULT_STALL_THRESHOLD_MS,
		),
		graceMs: readEnvMs('EVENT_LOOP_WATCHDOG_GRACE_MS', DEFAULT_GRACE_MS),
	}
}

/** What the worker carries between checks. Nothing derived from a clock. */
export type HeartbeatState = {
	lastCount: number
	/** Consecutive checks that saw no progress from the main thread. */
	stalledChecks: number
	/** Checks observed since start, used only to sit out the boot grace. */
	checks: number
}

export function initialHeartbeatState(): HeartbeatState {
	return { lastCount: -1, stalledChecks: 0, checks: 0 }
}

/**
 * How many consecutive no-progress checks add up to a stall, and how many
 * checks the boot grace covers. At least 2 no-progress checks are always
 * required: one observation cannot distinguish a wedged loop from a heartbeat
 * that simply had not fired yet when the worker looked.
 */
export function checksFor(config: EventLoopWatchdogConfig) {
	return {
		stallChecks: Math.max(
			2,
			Math.ceil(config.stallThresholdMs / config.checkIntervalMs),
		),
		graceChecks: Math.ceil(config.graceMs / config.checkIntervalMs),
	}
}

/**
 * Pure decision step, so the policy is testable without threads — the worker
 * is a thin loop around this. Returns the next state plus a reason when the
 * loop has been blocked long enough to act on.
 */
export function evaluateHeartbeat(
	state: HeartbeatState,
	count: number,
	config: EventLoopWatchdogConfig,
): { state: HeartbeatState; reason: string | null } {
	const { stallChecks, graceChecks } = checksFor(config)
	const progressed = count !== state.lastCount
	const next: HeartbeatState = {
		lastCount: count,
		stalledChecks: progressed ? 0 : state.stalledChecks + 1,
		checks: state.checks + 1,
	}
	if (next.checks <= graceChecks) return { state: next, reason: null }
	if (next.stalledChecks < stallChecks) return { state: next, reason: null }

	const blockedMs = next.stalledChecks * config.checkIntervalMs
	return {
		state: next,
		reason: `event loop made no progress for ${Math.round(blockedMs / 1000)}s across ${next.stalledChecks} checks (threshold ${Math.round(config.stallThresholdMs / 1000)}s)`,
	}
}

/**
 * Starts the heartbeat and the observing worker.
 *
 * Returns null when disabled (`EVENT_LOOP_WATCHDOG_CHECK_MS=0`, or the
 * explicit kill switch `EVENT_LOOP_WATCHDOG_ENABLED=false`) or when the worker
 * cannot start — a watchdog that fails to boot must never take the server down
 * with it. Both switches exist on purpose: the first matches the contract of
 * the sibling watchdogs, the second is something you can find and set in a
 * hurry when the thing that SIGKILLs production is the thing misbehaving.
 */
export function startEventLoopWatchdog({
	config = readEventLoopWatchdogConfig(),
	log = console.log,
	logError = console.error,
}: {
	config?: EventLoopWatchdogConfig
	log?: (message: string) => void
	logError?: (message: string, error?: unknown) => void
} = {}) {
	if (process.env.EVENT_LOOP_WATCHDOG_ENABLED === 'false') {
		log('💓 event-loop-watchdog disabled (EVENT_LOOP_WATCHDOG_ENABLED=false)')
		return null
	}
	if (config.checkIntervalMs === 0 || config.heartbeatIntervalMs === 0) {
		log('💓 event-loop-watchdog disabled (interval 0)')
		return null
	}

	// 4 bytes: a single counter, bumped by the main thread and read by the
	// worker. Atomics because the two threads race on it by construction.
	// Int32 wraparound is irrelevant — only *change* is ever tested.
	const sharedBuffer = new SharedArrayBuffer(4)
	const heartbeat = new Int32Array(sharedBuffer)

	let worker: Worker
	try {
		worker = new Worker(
			new URL('./event-loop-watchdog-worker.ts', import.meta.url),
			{ workerData: { sharedBuffer, config } },
		)
	} catch (error) {
		logError('💓 event-loop-watchdog: worker failed to start', error)
		return null
	}

	worker.on('error', (error) => {
		logError('💓 event-loop-watchdog: worker error, no longer guarding', error)
	})
	// Don't hold the process open for the watchdog's sake.
	worker.unref()

	const timer = setInterval(() => {
		Atomics.add(heartbeat, 0, 1)
	}, config.heartbeatIntervalMs)
	timer.unref?.()

	const { stallChecks } = checksFor(config)
	log(
		`💓 event-loop-watchdog: heartbeat every ${config.heartbeatIntervalMs / 1000}s, kill after ${stallChecks} consecutive checks with no progress (~${(stallChecks * config.checkIntervalMs) / 1000}s)`,
	)
	return { worker, timer }
}
