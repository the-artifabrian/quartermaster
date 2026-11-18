import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { cn } from '#app/utils/misc.tsx'

/**
 * A row of equal-width options with one sage pill under the selected one.
 * The pill slides between options (transform only, `--ease-micro`); with
 * reduced motion it moves without sliding.
 *
 * - `SegmentedControl` picks a value in place. `role="tablist"` when it
 *   switches what the page shows (each option a tab; give it an `idPrefix`
 *   and mark the shown panel with `tabPanelProps`), `"radiogroup"` when it
 *   picks a setting. Arrow keys move the selection, as in a native control:
 *   Left/Right (and Home/End) for tabs, any arrow for radios.
 * - `SegmentedLinks` is the same look for links between routes; the current
 *   one carries `aria-current="page"`.
 */
export function SegmentedControl<Value extends string>({
	options,
	value,
	onValueChange,
	role = 'radiogroup',
	idPrefix,
	className,
	...props
}: {
	options: ReadonlyArray<{ value: Value; label: React.ReactNode }>
	value: Value
	onValueChange: (value: Value) => void
	role?: 'tablist' | 'radiogroup'
	/** Ties each tab to its panel: see `tabPanelProps`. */
	idPrefix?: string
	className?: string
	'aria-label': string
}) {
	const buttons = useRef<Array<HTMLButtonElement | null>>([])
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	)
	const tabs = role === 'tablist'

	function onKeyDown(event: React.KeyboardEvent) {
		const last = options.length - 1
		const keys: Record<string, number | undefined> = {
			ArrowRight: (selectedIndex + 1) % options.length,
			ArrowLeft: (selectedIndex + last) % options.length,
			Home: 0,
			End: last,
			...(tabs
				? {}
				: {
						ArrowDown: (selectedIndex + 1) % options.length,
						ArrowUp: (selectedIndex + last) % options.length,
					}),
		}
		const next = keys[event.key]
		if (next === undefined) return
		event.preventDefault()
		onValueChange(options[next]!.value)
		buttons.current[next]?.focus()
	}

	return (
		<div
			role={role}
			aria-label={props['aria-label']}
			aria-orientation={tabs ? 'horizontal' : undefined}
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
						role={tabs ? 'tab' : 'radio'}
						{...(tabs
							? {
									'aria-selected': selected,
									id: idPrefix ? tabId(idPrefix, option.value) : undefined,
									// Only the shown panel is on the page.
									'aria-controls':
										idPrefix && selected
											? panelId(idPrefix, option.value)
											: undefined,
								}
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

/** Props for the panel a `SegmentedControl` tab shows. */
export function tabPanelProps(idPrefix: string, value: string) {
	return {
		role: 'tabpanel',
		id: panelId(idPrefix, value),
		'aria-labelledby': tabId(idPrefix, value),
	} as const
}

function tabId(idPrefix: string, value: string) {
	return `${idPrefix}-tab-${value}`
}

function panelId(idPrefix: string, value: string) {
	return `${idPrefix}-panel-${value}`
}

export function SegmentedLinks({
	links,
	current,
	slideFrom,
	className,
	...props
}: {
	links: ReadonlyArray<{
		to: string
		label: React.ReactNode
		viewTransition?: boolean
		state?: unknown
	}>
	/** The `to` of the page shown. */
	current: string
	/**
	 * The `to` of the page just left through this control. Each page renders
	 * its own copy, so the new copy starts its pill there and slides it over.
	 */
	slideFrom?: string
	className?: string
	'aria-label': string
}) {
	const currentIndex = Math.max(
		0,
		links.findIndex((link) => link.to === current),
	)
	const fromIndex = links.findIndex((link) => link.to === slideFrom)
	const [enterFrom, setEnterFrom] = useState(
		fromIndex === -1 || fromIndex === currentIndex ? null : fromIndex,
	)
	const pill = useRef<HTMLSpanElement>(null)
	useEffect(() => {
		if (enterFrom === null) return
		// Settle the start position, so the move to the current link slides.
		pill.current?.getBoundingClientRect()
		setEnterFrom(null)
	}, [enterFrom])
	const pillIndex = enterFrom ?? currentIndex
	return (
		<nav
			aria-label={props['aria-label']}
			className={cn(trackClassName, className)}
			style={{ gridTemplateColumns: `repeat(${links.length}, 1fr)` }}
		>
			<Pill ref={pill} index={pillIndex} count={links.length} />
			{links.map((link, index) => (
				<Link
					key={link.to}
					to={link.to}
					viewTransition={link.viewTransition}
					state={link.state}
					aria-current={index === currentIndex ? 'page' : undefined}
					className={segmentClassName(index === pillIndex)}
				>
					{link.label}
				</Link>
			))}
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
function Pill({
	index,
	count,
	ref,
}: {
	index: number
	count: number
	ref?: React.Ref<HTMLSpanElement>
}) {
	return (
		<span
			ref={ref}
			data-slot="segmented-pill"
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
