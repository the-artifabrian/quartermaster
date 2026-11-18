import type * as React from 'react'
import { useRef } from 'react'
import { Link } from 'react-router'

import { cn } from '#app/utils/misc.tsx'

/**
 * A row of equal-width options with one sage pill under the selected one.
 * The pill slides between options (transform only, `--ease-micro`); with
 * reduced motion it moves without sliding.
 *
 * - `SegmentedControl` picks a value in place. `role="tablist"` when it
 *   switches what the page shows (each option a tab), `"radiogroup"` when it
 *   picks a setting. Arrow keys move the selection, as in a native control.
 * - `SegmentedLinks` is the same look for links between routes; the current
 *   one carries `aria-current="page"`.
 */
export function SegmentedControl<Value extends string>({
	options,
	value,
	onValueChange,
	role = 'radiogroup',
	className,
	...props
}: {
	options: ReadonlyArray<{ value: Value; label: React.ReactNode }>
	value: Value
	onValueChange: (value: Value) => void
	role?: 'tablist' | 'radiogroup'
	className?: string
	'aria-label': string
}) {
	const buttons = useRef<Array<HTMLButtonElement | null>>([])
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	)

	function onKeyDown(event: React.KeyboardEvent) {
		const step =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0
		if (step === 0) return
		event.preventDefault()
		const next = (selectedIndex + step + options.length) % options.length
		onValueChange(options[next]!.value)
		buttons.current[next]?.focus()
	}

	return (
		<div
			role={role}
			aria-label={props['aria-label']}
			onKeyDown={onKeyDown}
			className={cn(trackClassName, className)}
			style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
		>
			<Pill index={selectedIndex} count={options.length} />
			{options.map((option, index) => {
				const selected = index === selectedIndex
				return (
					<button
						key={option.value}
						ref={(element) => {
							buttons.current[index] = element
						}}
						type="button"
						role={role === 'tablist' ? 'tab' : 'radio'}
						{...(role === 'tablist'
							? { 'aria-selected': selected }
							: { 'aria-checked': selected })}
						tabIndex={selected ? 0 : -1}
						onClick={() => onValueChange(option.value)}
						className={segmentClassName(selected)}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

export function SegmentedLinks({
	links,
	current,
	pending,
	className,
	...props
}: {
	links: ReadonlyArray<{
		to: string
		label: React.ReactNode
		viewTransition?: boolean
	}>
	/** The `to` of the page shown. */
	current: string
	/** The `to` being navigated to: the pill moves there before it loads. */
	pending?: string
	className?: string
	'aria-label': string
}) {
	const currentIndex = links.findIndex((link) => link.to === current)
	const pendingIndex = links.findIndex((link) => link.to === pending)
	const selectedIndex = Math.max(
		0,
		pendingIndex === -1 ? currentIndex : pendingIndex,
	)
	return (
		<nav
			aria-label={props['aria-label']}
			className={cn(trackClassName, className)}
			style={{ gridTemplateColumns: `repeat(${links.length}, 1fr)` }}
		>
			<Pill index={selectedIndex} count={links.length} />
			{links.map((link, index) => {
				const selected = index === selectedIndex
				return (
					<Link
						key={link.to}
						to={link.to}
						viewTransition={link.viewTransition}
						aria-current={index === currentIndex ? 'page' : undefined}
						className={segmentClassName(selected)}
					>
						{link.label}
					</Link>
				)
			})}
		</nav>
	)
}

const trackClassName = 'bg-muted/60 relative isolate grid rounded-lg'

function segmentClassName(selected: boolean) {
	return cn(
		'ring-ring flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium outline-hidden transition-colors duration-200 ease-(--ease-micro) focus-visible:ring-2',
		selected
			? 'text-primary-foreground'
			: 'text-muted-foreground hover:text-foreground',
	)
}

/** The sage pill, inset 4px inside the selected option's cell. */
function Pill({ index, count }: { index: number; count: number }) {
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-0 left-0 -z-10 p-1 transition-transform duration-200 ease-(--ease-micro) motion-reduce:transition-none"
			style={{
				width: `${100 / count}%`,
				transform: `translateX(${index * 100}%)`,
			}}
		>
			<span className="bg-primary block size-full rounded-md" />
		</span>
	)
}
