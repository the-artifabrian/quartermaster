// THROWAWAY #252/#242: does pre-transfer review save work beyond combined Shopping?
// One review alternative; all purchase changes are in memory and are NOT production contracts.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { type Route } from './+types/prototype-review.ts'

export async function loader({ request }: Route.LoaderArgs) {
	if (process.env.NODE_ENV === 'production')
		throw new Response('Not found', { status: 404 })
	await requireUserWithHousehold(request)
	return null
}

import {
	dishes,
	notes,
	type Line,
} from '../../../../scripts/prototypes/252-fixtures.ts'
const variants = [
	['A', 'Individual carts'],
	['B', 'Current combined → Shopping'],
	['C', 'Equivalent control → Shopping'],
	['D', 'Optional review → Shopping'],
] as const
const format = (line: Line) => `${line.amount ?? '?'} ${line.unit} ${line.name}`
function aggregate(lines: Line[]): Line[] {
	const combined = new Map<string, Line>()
	for (const original of lines) {
		const line =
			original.unit === 'kg'
				? {
						...original,
						amount: original.amount == null ? null : original.amount * 1000,
						unit: 'g',
					}
				: { ...original }
		const key = `${line.name}:${line.unit}`
		const previous = combined.get(key)
		if (previous && previous.amount != null && line.amount != null)
			previous.amount += line.amount
		else combined.set(key, line)
	}
	return [...combined.values()].sort((a, b) => a.name.localeCompare(b.name))
}

type Row = Line & {
	checked?: boolean
	existing?: boolean
	corrected?: boolean
	manualAmount?: number | null
}
const existing: Row[] = [
	{ name: 'milk', amount: 1, unit: 'l', existing: true },
	{ name: 'garlic', amount: 2, unit: 'cloves', checked: true, existing: true },
]

export default function PrototypeReview() {
	const [params, setParams] = useSearchParams()
	const variant = params.get('variant') ?? 'B'
	const scope = params.get('scope') ?? 'meal'
	const kitchen = params.get('kitchen') ?? 'none'
	const key = `${variant}:${scope}:${kitchen}`
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
			if (
				event.target instanceof HTMLElement &&
				event.target.closest('input, textarea, select, [contenteditable]')
			)
				return
			event.preventDefault()
			const index = variants.findIndex((v) => v[0] === variant)
			const next = new URLSearchParams(params)
			next.set(
				'variant',
				variants[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4]![0],
			)
			setParams(next)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [variant, params, setParams])

	return (
		<div className="container-grid w-full min-w-0 space-y-6 py-4 pb-64 [&_button]:scroll-mb-64">
			<aside
				className="bg-muted/40 space-y-3 rounded-lg p-4 text-sm"
				aria-label="Experiment controls"
			>
				<p className="font-medium">
					Disposable comparison · #252 / #242 · no application writes
				</p>
				<p>
					Does checking ingredients before transfer save work after aggregation
					and transfer effort are held equal? B reflects the current path; C and
					D share simulated quantity-correction and new-demand protections. D is
					the only review alternative.
				</p>
				<div className="flex flex-wrap gap-4">
					<label className="max-w-full min-w-0">
						Scope{' '}
						<select
							value={scope}
							onChange={(e) => {
								const next = new URLSearchParams(params)
								next.set('scope', e.target.value)
								setParams(next)
							}}
							className="border-border min-h-11 w-full max-w-full min-w-0 rounded border px-2"
						>
							<option value="meal">
								Saturday supper · four dishes + notes
							</option>
							<option value="single">Chickpea salad · one Recipe</option>
						</select>
					</label>
					<label className="max-w-full min-w-0">
						Kitchen facts{' '}
						<select
							value={kitchen}
							onChange={(e) => {
								const next = new URLSearchParams(params)
								next.set('kitchen', e.target.value)
								setParams(next)
							}}
							className="border-border min-h-11 w-full max-w-full min-w-0 rounded border px-2"
						>
							<option value="none">No corrections needed</option>
							<option value="have">Enough chickpeas for this dinner</option>
							<option value="partial">
								Enough chickpeas + 500 g rice already here
							</option>
						</select>
					</label>
				</div>
				<p>
					Existing Next shop: 1 l milk unchecked (another member), 2 cloves
					garlic checked. Normal olive oil is omitted; garlic is Out. Checking
					or omitting never restocks Staples. Unknown herbs/ice remain explicit.
					No automatic stock inference.
				</p>
			</aside>
			<Trial key={key} variant={variant} scope={scope} kitchen={kitchen} />
			<LifetimeComparison />
			<nav
				aria-label="Comparison variants"
				className="bg-foreground text-background fixed right-4 bottom-20 left-4 z-50 mx-auto flex max-w-xl items-center justify-between gap-2 rounded-lg p-2 shadow-lg"
			>
				<button
					aria-label="Previous variant"
					className="min-h-11 px-3"
					onClick={() => {
						const next = new URLSearchParams(params)
						next.set(
							'variant',
							variants[
								(variants.findIndex((v) => v[0] === variant) + 3) % 4
							]![0],
						)
						setParams(next)
					}}
				>
					←
				</button>
				<label className="min-w-0 flex-1 text-center text-sm">
					<span className="sr-only">Comparison variant</span>
					<select
						className="min-h-11 w-full bg-transparent"
						value={variant}
						onChange={(e) => {
							const next = new URLSearchParams(params)
							next.set('variant', e.target.value)
							setParams(next)
						}}
					>
						{variants.map(([value, label]) => (
							<option
								className="bg-background text-foreground"
								value={value}
								key={value}
							>
								{value} · {label}
							</option>
						))}
					</select>
				</label>
				<button
					aria-label="Next variant"
					className="min-h-11 px-3"
					onClick={() => {
						const next = new URLSearchParams(params)
						next.set(
							'variant',
							variants[
								(variants.findIndex((v) => v[0] === variant) + 1) % 4
							]![0],
						)
						setParams(next)
					}}
				>
					→
				</button>
			</nav>
		</div>
	)
}

function Trial({
	variant,
	scope,
	kitchen,
}: {
	variant: string
	scope: string
	kitchen: string
}) {
	const selected = scope === 'single' ? dishes.slice(0, 1) : dishes
	const batches = selected.map((d) => ({
		...d,
		lines: d.lines.map((l) => ({
			...l,
			amount: l.amount == null ? null : l.amount * d.scale,
		})),
	}))
	const requirements = aggregate([
		...batches.flatMap((d) => d.lines),
		...(scope === 'meal' ? notes : []),
	]).filter((l) => l.staple !== 'normal')
	const [stage, setStage] = useState<'source' | 'review' | 'shopping'>('source')
	const [openDish, setOpenDish] = useState<number | null>(null)
	const [facts, setFacts] = useState(false)
	const [draft, setDraft] = useState(requirements)
	const [rows, setRows] = useState<Row[]>(existing)
	const [events, setEvents] = useState<string[]>([])
	const [editing, setEditing] = useState<number | null>(null)
	const [editAmount, setEditAmount] = useState('')
	const log = (event: string) => setEvents((old) => [...old, event])
	const equivalent = variant === 'C' || variant === 'D'
	function transfer(lines: Line[]) {
		const next: Row[] = [
			...existing.map((r) => ({ ...r })),
			...(variant === 'B'
				? rows
						.filter((r) => r.corrected)
						.map((r) => ({ ...r, amount: r.manualAmount ?? null }))
				: []),
		]
		for (const line of lines.filter((l) => l.amount !== 0)) {
			// C/D explicitly simulate #225/#226 protections. B preserves current shared checked-row risk.
			const old = next.find((r) => r.name === line.name && r.unit === line.unit)
			if (old && !equivalent)
				old.amount = (old.amount ?? 0) + (line.amount ?? 0)
			else next.push({ ...line, checked: false })
		}
		setRows(next)
		setStage('shopping')
		log('Transfer combined requirements')
	}
	function addCart(line: Line) {
		// Current direct carts skip an existing canonical name; do not credit review for repairing this.
		if (!rows.some((r) => r.name === line.name))
			setRows((old) => [...old, { ...line }])
		log(`Individual cart: ${line.name}`)
	}
	const expected = requirements.map((l) => ({
		...l,
		amount:
			kitchen !== 'none' && l.name === 'chickpeas'
				? 0
				: kitchen === 'partial' && l.name === 'rice'
					? 100
					: l.amount,
	}))
	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
				<h1 className="font-serif text-2xl">
					{stage === 'shopping'
						? 'Shopping'
						: stage === 'review'
							? 'Check ingredients'
							: scope === 'meal'
								? 'Saturday supper'
								: 'Chickpea salad'}
				</h1>
				<Button
					variant="outline"
					onClick={() => {
						setFacts(!facts)
						log(facts ? 'Close kitchen facts' : 'Check kitchen')
					}}
				>
					Check kitchen
				</Button>
			</div>
			{facts && (
				<p className="bg-muted/40 rounded-lg p-3">
					{kitchen === 'none'
						? 'Buy every required non-Staple and Out ingredient. No corrections needed.'
						: kitchen === 'have'
							? 'You have all 400 g chickpeas for this dinner. Buy the remaining requirements.'
							: 'You have all 400 g chickpeas and 500 g of the required 600 g rice. Buy only 100 g rice for this dinner.'}{' '}
					Chickpeas stay a non-Staple. Milk and the previously checked garlic
					are unrelated purchases.
				</p>
			)}
			{stage === 'source' && (
				<>
					<p className="text-muted-foreground">
						{scope === 'meal'
							? 'Menu snapshot · four dishes at stored scales · sparkling water and ice note purchases'
							: 'One Recipe at 1× · no planning required'}
					</p>
					<div className="divide-border/40 divide-y">
						{batches.map((dish, i) => (
							<section key={dish.title} className="py-3">
								<button
									className="flex min-h-11 w-full items-center justify-between text-left"
									aria-expanded={openDish === i}
									onClick={() => {
										setOpenDish(openDish === i ? null : i)
										log(`Open/close Recipe: ${dish.title}`)
									}}
								>
									<span className="font-serif text-lg">{dish.title}</span>
									<span>{dish.scale}×</span>
								</button>
								{openDish === i && (
									<ul className="space-y-2">
										{dish.lines.map((line) => (
											<li
												key={line.name}
												className="flex items-center justify-between gap-3"
											>
												<span>
													{format(line)}{' '}
													{line.staple === 'normal'
														? '· Staple'
														: line.staple === 'out'
															? '· Out'
															: ''}
												</span>
												{variant === 'A' && (
													<Button
														variant="outline"
														onClick={() => addCart(line)}
													>
														Add {line.name}
													</Button>
												)}
											</li>
										))}
									</ul>
								)}
							</section>
						))}
						{scope === 'meal' && (
							<section className="space-y-2 py-3">
								<h2 className="font-serif text-lg">Serve cold</h2>
								{notes.map((line) => (
									<div
										key={line.name}
										className="flex items-center justify-between gap-3"
									>
										<span>{format(line)}</span>
										{variant === 'A' && (
											<Button variant="outline" onClick={() => addCart(line)}>
												Add {line.name}
											</Button>
										)}
									</div>
								))}
							</section>
						)}
					</div>
					{variant === 'A' ? (
						<Button
							onClick={() => {
								setStage('shopping')
								log('Open Shopping')
							}}
						>
							Open Shopping
						</Button>
					) : variant === 'D' ? (
						<div className="flex flex-wrap gap-3">
							<Button onClick={() => transfer(requirements)}>
								Add to Shopping
							</Button>
							<Button
								variant="outline"
								onClick={() => {
									setStage('review')
									log('Open optional review')
								}}
							>
								Check ingredients first
							</Button>
						</div>
					) : (
						<Button onClick={() => transfer(requirements)}>
							Add to Shopping
						</Button>
					)}
					<p className="text-muted-foreground text-sm">
						{variant === 'A'
							? 'A models individual Recipe carts and manual note additions; existing names are skipped, so shared ingredients can be undercounted. This defect is not a review benefit.'
							: equivalent
								? 'SIMULATED CONTROL: C and D have identical combined transfer, explicit total correction and safe new-demand behavior. For a Recipe this bulk control is proposed; for a Meal, combined transfer already exists.'
								: 'B models combined Meal contribution display and current correction behavior. This fixture is not a full reimplementation: calendar navigation, toasts and timing are omitted. Single-Recipe bulk transfer here exposes the existing action boundary, not a claim that its proposed placement has shipped.'}
					</p>
				</>
			)}
			{stage === 'review' && (
				<>
					<p>
						For{' '}
						{scope === 'meal'
							? 'Saturday supper at its planned scales'
							: 'Chickpea salad at 1×'}
						. Set an amount to 0 to omit it from this transfer. The temporary
						decision applies only to this intended cook in this experiment;
						future behavior is compared below.
					</p>
					<div className="divide-border/40 divide-y">
						{draft.map((line, i) => (
							<label
								key={line.name}
								className="flex min-h-16 items-center justify-between gap-3 py-2"
							>
								<span>
									{line.name} {line.staple === 'out' ? '· Out' : ''}
									<small className="text-muted-foreground block">
										Required: {format(requirements[i]!)}
									</small>
								</span>
								{line.amount == null ? (
									<span>{line.unit} · quantity unresolved</span>
								) : (
									<span>
										<input
											aria-label={`Buy ${line.name}`}
											className="border-border min-h-11 w-24 rounded border px-2"
											type="number"
											min="0"
											value={line.amount}
											onChange={(e) => {
												setDraft((old) =>
													old.map((l, j) =>
														j === i
															? {
																	...l,
																	amount: Math.max(0, Number(e.target.value)),
																}
															: l,
													),
												)
												log(`Review amount: ${line.name}`)
											}}
										/>{' '}
										{line.unit}
									</span>
								)}
							</label>
						))}
					</div>
					<div className="flex gap-3">
						<Button onClick={() => transfer(draft)}>Add to Shopping</Button>
						<Button
							variant="outline"
							onClick={() => {
								setStage('source')
								log('Return to Meal/Recipe')
							}}
						>
							Cancel review
						</Button>
					</div>
				</>
			)}
			{stage === 'shopping' && (
				<>
					<p className="text-muted-foreground">
						Next shop · {rows.filter((r) => r.checked).length}/{rows.length}{' '}
						checked
					</p>
					<div className="divide-border/40 divide-y">
						{rows.map((line, i) => (
							<div
								key={i}
								className="flex min-h-16 flex-wrap items-center gap-3 py-2"
							>
								<input
									type="checkbox"
									aria-label={`Check ${line.name} ${i}`}
									checked={Boolean(line.checked)}
									onChange={() => {
										setRows((old) =>
											old.map((l, j) =>
												i === j ? { ...l, checked: !l.checked } : l,
											),
										)
										log(`Check/uncheck: ${line.name}`)
									}}
									className="size-6"
								/>
								<span
									className={`min-w-0 flex-1 ${line.checked ? 'text-muted-foreground line-through' : ''}`}
								>
									{format(line)}
									{line.existing ? ' · existing' : ''}
								</span>
								<Button
									variant="ghost"
									onClick={() => {
										setEditing(i)
										setEditAmount(
											String(
												(line.corrected ? line.manualAmount : line.amount) ??
													'',
											),
										)
										log(`Open correction: ${line.name}`)
									}}
								>
									Edit {line.name}
								</Button>
								{editing === i && (
									<form
										className="flex w-full flex-wrap items-center gap-2"
										onSubmit={(e) => {
											e.preventDefault()
											const amount =
												editAmount === '' ? null : Number(editAmount)
											setRows((old) =>
												old.map((l, j) =>
													j !== i
														? l
														: {
																...l,
																amount,
																corrected: variant === 'B' && !l.existing,
																manualAmount: amount,
															},
												),
											)
											setEditing(null)
											log(`Save correction: ${line.name}`)
										}}
									>
										<label>
											Purchase amount{' '}
											<input
												aria-label={`Purchase amount for ${line.name}`}
												className="border-border min-h-11 w-24 rounded border px-2"
												type="number"
												min="0"
												value={editAmount}
												onChange={(e) => setEditAmount(e.target.value)}
											/>
										</label>
										<Button type="submit">Save</Button>
										<Button
											type="button"
											variant="outline"
											onClick={() => {
												setRows((old) => old.filter((_, j) => j !== i))
												setEditing(null)
												log(`Remove: ${line.name}`)
											}}
										>
											Remove this purchase
										</Button>
									</form>
								)}
							</div>
						))}
					</div>
					<Button
						variant="outline"
						onClick={() => {
							setStage('source')
							log('Return to Meal/Recipe')
						}}
					>
						Return to {scope === 'meal' ? 'Meal' : 'Recipe'}
					</Button>
				</>
			)}
			<details className="bg-muted/40 rounded-lg p-4 text-sm">
				<summary className="min-h-11 cursor-pointer">
					Experiment evidence: intended result, actions and limitations
				</summary>
				<p>
					Target additions, excluding existing milk and handled garlic:{' '}
					{expected
						.filter((l) => l.amount !== 0)
						.map(format)
						.join('; ')}
					. Unknown amounts need a human check. Existing checked garlic does not
					pay for this Meal.
				</p>
				<p>
					Actions recorded: {events.length}. Input events are logged, not a
					standardized tap score. Count actual Recipe revisits, kitchen trips,
					corrections and rereading yourself; these logs do not measure
					household effort.
				</p>
				<ol className="list-inside list-decimal">
					{events.map((event, i) => (
						<li key={i}>{event}</li>
					))}
				</ol>
				<p>
					B deliberately exposes the observed generated-total edit problem (600
					g → enter 100 g → 700 g). C/D simulate replacement of the intended
					source total. Do not credit D for that repair. B's duplicate/checked
					examples are illustrative; use the real app for backend correctness
					evidence. Switching a variant or fixture resets all in-memory work.
				</p>
			</details>
		</>
	)
}

const cases = [
	{
		title: 'Edit 600 g → 100 g → refresh 600 g',
		before: '600 g unchecked, generated for Saturday supper.',
		action:
			'Enter 100 g as the intended purchase total, then explicitly refresh unchanged requirements.',
		completion:
			'PROPOSED extension to #227, still undecided: 100 g unchecked; retain this cook’s 500 g kitchen offset. Reconcile only a later requirement change. Offset ends when this cook is retired.',
		snapshot:
			'100 g unchecked until explicit replacement. Refresh asks whether to keep the correction or replace it with 600 g; no automatic 700 g. Extra confirmation only on overlap.',
	},
	{
		title: 'Legacy 200 g → Plan needs 400 g',
		before:
			'200 g from an older Recipe request; provenance cannot establish overlap.',
		action: 'Generate the planned Meal.',
		completion:
			'Keep legacy 200 g and show new 400 g unchecked (600 g total if compatible). An explicit correction can remove overlap; never assume it.',
		snapshot:
			'Keep 200 g and ask on this overlap: add a separate 400 g cook (600 g) or replace this known purchase with 400 g. Unknown intent leaves existing purchases intact and generation unconfirmed.',
	},
	{
		title: 'Retry → another unplanned cook → plan same cook',
		before:
			'A direct cook needs 400 g; a repeated request has the same operation identity.',
		action: 'Retry, request another cook explicitly, then plan the first cook.',
		completion:
			'Retry adds 0. “Another cook” creates a distinct source and adds 400 g unchecked. Planning the first cook transfers its identity and corrections to its Meal; no extra 400 g.',
		snapshot:
			'Retry adds 0 within one bounded operation. Another cook starts an explicit fresh request. Planning after direct shopping requires explicit overlap confirmation before generating again; no inferred identity from Recipe title.',
	},
	{
		title: 'Handle 200 g → need 600 g → decrease → clear → refresh',
		before: 'Current cook: 200 g required and checked.',
		action:
			'Increase to 600 g; decrease to 100 g; increase back to 600 g; clear checked rows; refresh; then remove all demand and request another cook.',
		completion:
			'Increase: 200 g handled + 400 g unchecked. Decrease to 100 g: no outstanding; retain the 200 g baseline while this source is active. Re-increase to 600 g: 400 g outstanding. Clear checked 200 g while 400 g remains: unchanged refresh keeps 400 g. Remove all source demand: a later explicit addition may request the full amount. A distinct new cook is fully unchecked.',
		snapshot:
			'Increase: confirm a 400 g top-up against the displayed prior requirement; do not silently check it. Decrease: explicit correction to 100 g handled. Re-increase requires explicit top-up reconciliation. Clear preserves any outstanding 400 g snapshot but carries no hidden credit; later replacement requires a fresh kitchen check/overlap choice. Removing all demand retires the snapshot. New cook is fully unchecked.',
	},
	{
		title: 'Unknown amounts, incompatible units, another member',
		before: 'Herbs “to taste”, 1 bunch herbs, and another member’s 1 l milk.',
		action: 'Correct or refresh the Meal.',
		completion:
			'Keep unresolved text and incompatible units distinct; reconcile only provably compatible quantities. Preserve milk and require explicit correction of the affected source.',
		snapshot:
			'Keep those lines separate. Any overlap choice names the affected purchase; no replacement of unrelated milk. Neither model guesses conversion or kitchen stock.',
	},
]
function LifetimeComparison() {
	const [active, setActive] = useState(0)
	const [after, setAfter] = useState(false)
	const [placement, setPlacement] = useState<'detail' | 'meal'>('meal')
	const [surface, setSurface] = useState<'recipe' | 'meal'>('recipe')
	const [added, setAdded] = useState(false)
	const current = cases[active]!
	return (
		<section
			className="space-y-4 border-t pt-6"
			aria-label="Purchase decision comparison"
		>
			<h2 className="font-serif text-xl">
				#242 · unresolved purchase lifetime and placement
			</h2>
			<p className="text-sm">
				These are candidate outcomes, not accepted behavior. The
				source-completion candidate retains current-cook corrections/handled
				amounts; the snapshot candidate pays for explicit overlap choices and
				repeated kitchen checking after retirement. Neither is automatically
				simpler.
			</p>
			<label>
				Case{' '}
				<select
					className="border-border min-h-11 w-full rounded border px-2"
					value={active}
					onChange={(e) => {
						setActive(Number(e.target.value))
						setAfter(false)
					}}
				>
					{cases.map((c, i) => (
						<option key={c.title} value={i}>
							{c.title}
						</option>
					))}
				</select>
			</label>
			<p>
				<strong>Before:</strong> {current.before}
			</p>
			<p>
				<strong>Action:</strong> {current.action}
			</p>
			<Button variant="outline" onClick={() => setAfter(!after)}>
				{after ? 'Show before' : 'Show both outcomes'}
			</Button>
			{after && (
				<div className="grid gap-4 md:grid-cols-2">
					<div className="bg-muted/40 rounded-lg p-4">
						<h3 className="font-medium">Completion candidate</h3>
						<p>{current.completion}</p>
					</div>
					<div className="bg-muted/40 rounded-lg p-4">
						<h3 className="font-medium">
							Snapshot / explicit overlap candidate
						</h3>
						<p>{current.snapshot}</p>
					</div>
				</div>
			)}
			<h3 className="font-serif text-lg">Planned Recipe action placement</h3>
			<div className="flex flex-wrap gap-3">
				{(['meal', 'detail'] as const).map((value) => (
					<Button
						key={value}
						variant="outline"
						aria-pressed={placement === value}
						onClick={() => {
							setPlacement(value)
							setSurface('recipe')
							setAdded(false)
						}}
					>
						{value === 'meal'
							? 'Whole-Meal action at Meal'
							: 'Whole-Meal action on Recipe'}
					</Button>
				))}
			</div>
			<div className="space-y-3 border-y py-4">
				<h4 className="font-serif text-lg">
					{surface === 'recipe'
						? 'Lemon rice · viewing 3×'
						: 'Saturday supper · planned quantities'}
				</h4>
				<p>
					{surface === 'recipe'
						? 'Opened from Saturday supper. Planned rice scale is 2×; viewing 3× shows 600 g rice and does not edit Plan.'
						: 'Chickpea salad 1×; Lemon rice 2× (400 g rice); stuffed peppers 1× (200 g rice); yogurt dip 0.5×; sparkling water and ice notes.'}
				</p>
				{surface === 'recipe' && placement === 'meal' ? (
					<Button onClick={() => setSurface('meal')}>
						Open Saturday supper
					</Button>
				) : (
					<Button onClick={() => setAdded(true)}>
						Add Saturday supper to Shopping
					</Button>
				)}
				{surface === 'meal' && (
					<Button variant="outline" onClick={() => setSurface('recipe')}>
						Return to Lemon rice · 3×
					</Button>
				)}
				{added && (
					<p role="status">
						Simulated: whole Meal at planned scales, including notes. Rice total
						600 g from two dishes; no new direct Recipe cook was created.
						Viewing 3× remains unchanged.
					</p>
				)}
			</div>
		</section>
	)
}
