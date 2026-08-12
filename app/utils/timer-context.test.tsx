/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
	formatTime,
	getTimerRemainingSeconds,
	TimerProvider,
	useTimers,
} from './timer-context.tsx'

type TimerControls = ReturnType<typeof useTimers>

function setupFakeTimerClock() {
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2026-08-12T09:00:00Z'))
	localStorage.clear()

	return {
		[Symbol.dispose]() {
			vi.useRealTimers()
			vi.unstubAllGlobals()
			localStorage.clear()
		},
	}
}

function TimerProbe({
	onRender,
}: {
	onRender: (controls: TimerControls) => void
}) {
	const controls = useTimers()
	onRender(controls)
	const timer = controls.timers[0]

	return (
		<>
			<output>
				{timer
					? `${timer.status}:${formatTime(
							getTimerRemainingSeconds(timer, controls.now),
						)}`
					: 'none'}
			</output>
			<button onClick={() => controls.addTimer('Pasta', 2)}>Add timer</button>
			{timer?.status === 'alarming' ? (
				<button onClick={() => controls.dismissAlarm(timer.id)}>
					Dismiss timer
				</button>
			) : null}
		</>
	)
}

test('does not schedule work or rerender consumers without active timers', () => {
	using _clock = setupFakeTimerClock()
	const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
	let renderCount = 0
	const child = <TimerProbe onRender={() => renderCount++} />
	const view = render(<TimerProvider>{child}</TimerProvider>)

	expect(setIntervalSpy).not.toHaveBeenCalled()
	expect(renderCount).toBe(1)

	view.rerender(<TimerProvider>{child}</TimerProvider>)

	expect(setIntervalSpy).not.toHaveBeenCalled()
	expect(renderCount).toBe(1)
})

test('ticks running timers, fires the alarm, and stops after dismissal', async () => {
	using _clock = setupFakeTimerClock()
	const vibrate = vi.fn()
	vi.stubGlobal('AudioContext', undefined)
	vi.stubGlobal('navigator', { vibrate })
	const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
	const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
	let renderCount = 0
	render(
		<TimerProvider>
			<TimerProbe onRender={() => renderCount++} />
		</TimerProvider>,
	)

	fireEvent.click(screen.getByRole('button', { name: 'Add timer' }))
	expect(setIntervalSpy).toHaveBeenCalledTimes(1)
	expect(screen.getByRole('status')).toHaveTextContent('running:00:02')

	await act(() => vi.advanceTimersByTimeAsync(1_000))
	expect(screen.getByRole('status')).toHaveTextContent('running:00:01')

	await act(() => vi.advanceTimersByTimeAsync(1_000))
	expect(screen.getByRole('status')).toHaveTextContent('alarming:00:00')
	expect(vibrate).toHaveBeenCalledWith([200, 100, 200, 100, 200])
	expect(clearIntervalSpy).not.toHaveBeenCalled()

	fireEvent.click(screen.getByRole('button', { name: 'Dismiss timer' }))
	expect(screen.getByRole('status')).toHaveTextContent('none')
	expect(clearIntervalSpy).toHaveBeenCalledTimes(1)

	const rendersAfterDismissal = renderCount
	await act(() => vi.advanceTimersByTimeAsync(1_000))
	expect(renderCount).toBe(rendersAfterDismissal)
})
