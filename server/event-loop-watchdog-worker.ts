import { workerData } from 'node:worker_threads'
import {
	evaluateHeartbeat,
	initialHeartbeatState,
	type EventLoopWatchdogConfig,
} from './event-loop-watchdog.ts'

// Runs on its own OS thread with its own event loop, so it keeps ticking while
// the main thread is wedged — the whole point of the watchdog. See
// server/event-loop-watchdog.ts for the design and why the decision is made on
// a counter rather than a clock.

const { sharedBuffer, config } = workerData as {
	sharedBuffer: SharedArrayBuffer
	config: EventLoopWatchdogConfig
}

const heartbeat = new Int32Array(sharedBuffer)
let state = initialHeartbeatState()

// Not unref'd on purpose: this timer is the only thing keeping the worker's
// event loop alive, and an unref'd one would let the thread exit immediately.
// The parent calls worker.unref() instead, so the watchdog never holds the
// process open by itself.
setInterval(() => {
	const result = evaluateHeartbeat(
		state,
		Atomics.load(heartbeat, 0),
		config,
	)
	state = result.state
	if (result.reason === null) return

	// stdout from a worker still reaches the process's stdout, so this lands in
	// `fly logs` and is the only diagnosis we get — the main thread cannot run a
	// shutdown handler or flush telemetry while it is blocked.
	console.error(
		`💓 event-loop-watchdog: ${result.reason} — killing the process so Fly restarts us. ` +
			`The main thread is spinning; look for superlinear work on the request path.`,
	)

	// SIGKILL our own PID. process.exit() would only end this worker, and the
	// wedged main thread cannot participate in a graceful shutdown.
	process.kill(process.pid, 'SIGKILL')
}, config.checkIntervalMs)
