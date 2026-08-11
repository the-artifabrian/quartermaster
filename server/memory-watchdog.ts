import fs from 'node:fs'
import { shutdownPostHog } from '../app/utils/posthog.server.ts'

// Last line of defense against slow memory leaks on the 512MB Fly box: two
// separate leaks (SSR heap ratchet, zombie SSE streams) each took prod from
// healthy to page-cache thrash over days, and Fly's health checks only stop
// routing — they never restart the machine. The watchdog samples memory and,
// on a sustained breach that a forced full GC can't fix, exits non-zero so
// Fly's `on-failure` restart policy reboots us in seconds — a blip instead of
// a multi-hour crawl.
//
// Two independent breach conditions, because they see different failure
// stages: box-wide MemAvailable catches imminent thrash regardless of which
// process is responsible; our own VmSwap catches a leak that has quietly
// parked hundreds of MB in swap while MemAvailable still looks tolerable.

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_MIN_AVAILABLE_MB = 50
const DEFAULT_MAX_SWAP_MB = 250
// Consecutive breaching samples (each surviving a forced GC) before exiting:
// 3 × 30s means a transient allocation spike never kills the process.
const BREACHES_BEFORE_EXIT = 3
// Samples to skip after boot — migrations, LiteFS sync, and first renders
// make early memory numbers unrepresentative, and the grace also bounds a
// worst-case restart loop to one reboot per ~7 minutes with the app serving
// in between.
const GRACE_SAMPLES = 10
// Every Nth sample, log a summary line. Fly's log buffer only holds ~30min,
// so 5-minute granularity is what makes a future leak diagnosable from logs.
const LOG_EVERY_SAMPLES = 10

export interface WatchdogConfig {
	intervalMs: number
	minAvailableMb: number
	maxSwapMb: number
}

export interface MemorySample {
	/** Box-wide MemAvailable from /proc/meminfo, in MB. */
	memAvailableMb: number | null
	/** This process's swapped-out memory from /proc/self/status, in MB. */
	vmSwapMb: number | null
	/** This process's resident set from /proc/self/status, in MB. */
	vmRssMb: number | null
}

const KB_LINE = /^(\w+):\s+(\d+)\s*kB/

function parseKbField(text: string, field: string): number | null {
	for (const line of text.split('\n')) {
		const match = KB_LINE.exec(line)
		if (match?.[1] === field) return Math.round(Number(match[2]) / 1024)
	}
	return null
}

export function parseMemAvailableMb(meminfo: string): number | null {
	return parseKbField(meminfo, 'MemAvailable')
}

export function parseProcStatus(status: string): {
	vmSwapMb: number | null
	vmRssMb: number | null
} {
	return {
		vmSwapMb: parseKbField(status, 'VmSwap'),
		vmRssMb: parseKbField(status, 'VmRSS'),
	}
}

/**
 * Returns a human-readable breach reason, or null if the sample is healthy.
 * Unreadable fields (null) never count as a breach — a broken /proc read must
 * not be able to kill the process.
 */
export function breachReason(
	sample: MemorySample,
	config: WatchdogConfig,
): string | null {
	if (
		sample.memAvailableMb !== null &&
		sample.memAvailableMb < config.minAvailableMb
	) {
		return `MemAvailable ${sample.memAvailableMb}MB < ${config.minAvailableMb}MB`
	}
	if (sample.vmSwapMb !== null && sample.vmSwapMb > config.maxSwapMb) {
		return `VmSwap ${sample.vmSwapMb}MB > ${config.maxSwapMb}MB`
	}
	return null
}

export function createBreachTracker(threshold: number = BREACHES_BEFORE_EXIT) {
	let consecutive = 0
	return {
		record(reason: string | null): { shouldExit: boolean; count: number } {
			consecutive = reason === null ? 0 : consecutive + 1
			return { shouldExit: consecutive >= threshold, count: consecutive }
		},
	}
}

function readEnvMb(name: string, fallback: number): number {
	const raw = process.env[name]
	if (!raw) return fallback
	const value = Number(raw)
	if (!(value > 0 && Number.isFinite(value))) {
		console.warn(`⚠️ Ignoring invalid ${name}=${raw}; using ${fallback}`)
		return fallback
	}
	return value
}

export function readWatchdogConfig(): WatchdogConfig {
	// Mirrors the BUN_GC_INTERVAL_MS contract: 0 disables, invalid values fall
	// back to the default (never reach setInterval, which clamps fractional or
	// >2^31-1 inputs to ~1ms).
	let intervalMs = Number(
		process.env.MEMORY_WATCHDOG_INTERVAL_MS || DEFAULT_INTERVAL_MS,
	)
	if (intervalMs !== 0 && !(intervalMs >= 1000 && intervalMs <= 2 ** 31 - 1)) {
		console.warn(
			`⚠️ Ignoring invalid MEMORY_WATCHDOG_INTERVAL_MS=${process.env.MEMORY_WATCHDOG_INTERVAL_MS}; using ${DEFAULT_INTERVAL_MS}ms`,
		)
		intervalMs = DEFAULT_INTERVAL_MS
	}
	return {
		intervalMs,
		minAvailableMb: readEnvMb(
			'MEMORY_WATCHDOG_MIN_AVAILABLE_MB',
			DEFAULT_MIN_AVAILABLE_MB,
		),
		maxSwapMb: readEnvMb('MEMORY_WATCHDOG_MAX_SWAP_MB', DEFAULT_MAX_SWAP_MB),
	}
}

function readProcSample(): MemorySample {
	let memAvailableMb: number | null = null
	let vmSwapMb: number | null = null
	let vmRssMb: number | null = null
	try {
		memAvailableMb = parseMemAvailableMb(
			fs.readFileSync('/proc/meminfo', 'utf8'),
		)
	} catch {
		// Leave null — never breach on a failed read
	}
	try {
		const status = parseProcStatus(fs.readFileSync('/proc/self/status', 'utf8'))
		vmSwapMb = status.vmSwapMb
		vmRssMb = status.vmRssMb
	} catch {
		// Leave null — never breach on a failed read
	}
	return { memAvailableMb, vmSwapMb, vmRssMb }
}

export function startMemoryWatchdog({
	gc,
	readSample = readProcSample,
	fatal,
	flushTelemetry = shutdownPostHog,
	exit = (code: number) => process.exit(code),
}: {
	gc?: (force: boolean) => void
	readSample?: () => MemorySample
	fatal?: (message: string) => void | Promise<void>
	flushTelemetry?: () => Promise<void>
	exit?: (code: number) => void
} = {}) {
	const handleFatal =
		fatal ??
		(async (message: string) => {
			console.error(message)
			try {
				// PostHog buffers both analytics and reported server errors.
				await flushTelemetry()
			} catch (error) {
				console.error(
					'🐕 memory-watchdog: telemetry flush failed during fatal exit',
					error,
				)
			} finally {
				exit(1)
			}
		})
	const config = readWatchdogConfig()
	if (config.intervalMs === 0) {
		console.log('🐕 memory-watchdog disabled (MEMORY_WATCHDOG_INTERVAL_MS=0)')
		return null
	}
	if (readSample === readProcSample && !fs.existsSync('/proc/meminfo')) {
		// Not a Linux box (local dev on macOS) — nothing to watch. An injected
		// sampler (tests) doesn't need /proc.
		return null
	}

	console.log(
		`🐕 memory-watchdog: every ${config.intervalMs / 1000}s, exit when MemAvailable<${config.minAvailableMb}MB or VmSwap>${config.maxSwapMb}MB for ${BREACHES_BEFORE_EXIT} samples`,
	)
	const tracker = createBreachTracker()
	let samples = 0
	const timer = setInterval(() => {
		samples++
		let sample = readSample()
		if (samples % LOG_EVERY_SAMPLES === 0) {
			console.log(
				`🐕 memory-watchdog: mem_available=${sample.memAvailableMb}MB rss=${sample.vmRssMb}MB swap=${sample.vmSwapMb}MB`,
			)
		}
		if (samples <= GRACE_SAMPLES) return
		let reason = breachReason(sample, config)
		if (reason !== null && gc) {
			// Give a collectable heap one chance before the breach counts — only
			// rooted memory (a real leak) or external pressure survives a full GC.
			gc(true)
			sample = readSample()
			reason = breachReason(sample, config)
		}
		const { shouldExit, count } = tracker.record(reason)
		if (reason !== null) {
			console.warn(
				`🐕 memory-watchdog: breach ${count}/${BREACHES_BEFORE_EXIT} (${reason}) rss=${sample.vmRssMb}MB swap=${sample.vmSwapMb}MB`,
			)
		}
		if (shouldExit) {
			clearInterval(timer)
			void handleFatal(
				`🐕 memory-watchdog: ${reason} for ${count} consecutive samples after forced GC — exiting so Fly restarts us before the box starts thrashing`,
			)
		}
	}, config.intervalMs)
	timer.unref?.()
	return timer
}
