import { parseWithZod } from '@conform-to/zod/v4'
import { invariantResponse } from '@epic-web/invariant'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useIsDemo } from '#app/components/demo.tsx'
import { goneItemMiddleware } from '#app/components/gone-item.tsx'
import {
	NotInHouseholdBoundary,
	notFoundTitle,
} from '#app/components/not-in-household.tsx'
import {
	navActionButton,
	navActionIcon,
	type NavBarHandle,
	useNavBarActions,
} from '#app/components/nav-bar.tsx'
import { menuDetailNav } from '#app/utils/nav-back.ts'
import { useRef, useState } from 'react'
import {
	data,
	Form,
	redirect,
	useNavigation,
	useRouteLoaderData,
} from 'react-router'
import { toast } from 'sonner'
import { MenuContents } from '#app/components/menu-contents.tsx'
import { BottomSheet, opensAsSheet } from '#app/components/ui/bottom-sheet.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '#app/components/ui/tooltip.tsx'
import {
	getWeekStart,
	loadedToday,
	MEAL_TYPES,
	MEAL_TYPE_LABELS,
	serializeDate,
} from '#app/utils/date.ts'
import { prisma } from '#app/utils/db.server.ts'
import { requireUserWithHousehold } from '#app/utils/household.server.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { PlanMenuSchema } from '#app/utils/meal-plan-validation.ts'
import { cn } from '#app/utils/misc.tsx'
import { EMPTY_MENU_MESSAGE, planMenu } from '#app/utils/plan-menu.server.ts'
import { servingInstantFromWallTime } from '#app/utils/serving-time.ts'
import { DEMO_BLOCKED_MESSAGE } from '#app/utils/demo.ts'
import { browserShareFunctions, shareOrCopy } from '#app/utils/share-link.ts'
import { type Route } from './+types/$menuId.ts'
import { PushLink } from '#app/components/push-link.tsx'

// Going back to this page once its item is gone opens /recipes/menus instead.
export const clientMiddleware: Route.ClientMiddlewareFunction[] = [
	goneItemMiddleware('/recipes/menus'),
]

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: menuDetailNav,
	navActions: MenuBarActions,
}

/** Share and Edit in the nav bar on a phone. */
function MenuBarActions({ data }: { data: unknown }) {
	// The bar draws these only with the loader's data; nothing without it.
	if (!data) return null
	const { menu } = data as Route.ComponentProps['loaderData']
	return <MenuNavActions menu={menu} />
}

function MenuNavActions({ menu }: { menu: { id: string; title: string } }) {
	const share = useShareMenu(menu)
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Share"
				className={navActionButton}
				onClick={share}
			>
				<Icon name="share" className={navActionIcon} />
			</Button>
			<Button
				asChild
				variant="ghost"
				size="icon"
				aria-label="Edit"
				className={navActionButton}
			>
				<PushLink to={`/recipes/menus/${menu.id}/edit`}>
					<Icon name="pencil-1" className={navActionIcon} />
				</PushLink>
			</Button>
		</>
	)
}

/**
 * Shares the Menu's public link, or copies it where there is no share sheet.
 * The page's own Share and the nav bar's both use it.
 */
function useShareMenu(menu: { id: string; title: string }) {
	// A demo's Menus aren't shared (share.menus.$menuId.tsx).
	const isDemo = useIsDemo()
	const rootData = useRouteLoaderData('root') as
		{ requestInfo?: { origin?: string } } | undefined
	const origin = rootData?.requestInfo?.origin
	// Taps are ignored until the first share settles, so a second tap cannot
	// copy the link behind an open sheet.
	const shareInFlight = useRef(false)
	return async function share() {
		if (isDemo) {
			toast.error(DEMO_BLOCKED_MESSAGE)
			return
		}
		if (shareInFlight.current) return
		shareInFlight.current = true
		try {
			const url = `${origin ?? window.location.origin}/share/menus/${menu.id}`
			// share() is the first await, so it runs inside the tap's activation.
			const outcome = await shareOrCopy({
				data: { title: menu.title, url },
				...browserShareFunctions(),
			})
			if (outcome === 'copied') {
				toast.success('Public link copied', {
					description:
						'Anyone with this link can view the Menu and its Recipes.',
				})
			} else if (outcome === 'copy-failed') {
				toast.error('Couldn’t copy the link. Try again.')
			}
		} finally {
			shareInFlight.current = false
		}
	}
}

export const meta: Route.MetaFunction = ({ loaderData, error }) => {
	const title = loaderData?.menu?.title
		? `${loaderData.menu.title} | Quartermaster`
		: (notFoundTitle(error, 'Menu') ?? 'Menu | Quartermaster')
	return [{ title }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const { menuId } = params

	const menu = await prisma.menu.findUnique({
		where: { id: menuId },
		select: {
			id: true,
			title: true,
			description: true,
			defaultGuestCount: true,
			householdId: true,
			sections: {
				orderBy: { order: 'asc' },
				select: {
					id: true,
					name: true,
					items: {
						orderBy: { order: 'asc' },
						select: {
							id: true,
							kind: true,
							recipeTitle: true,
							scaleMultiplier: true,
							note: true,
							recipe: {
								select: {
									id: true,
									title: true,
									householdId: true,
									yieldAmount: true,
									yieldLabel: true,
									image: { select: { objectKey: true } },
								},
							},
							shoppingLines: {
								orderBy: { order: 'asc' },
								select: {
									id: true,
									name: true,
									quantity: true,
									unit: true,
								},
							},
						},
					},
				},
			},
		},
	})

	invariantResponse(menu, 'Menu not found', { status: 404 })
	invariantResponse(menu.householdId === householdId, 'Not authorized', {
		status: 403,
	})

	return {
		menu: {
			...menu,
			sections: menu.sections.map((section) => ({
				...section,
				items: section.items.map((item) => {
					// A reference that doesn't resolve to a household Recipe reads as
					// a clearly missing card with its frozen identity.
					const recipe =
						item.recipe && item.recipe.householdId === householdId
							? {
									id: item.recipe.id,
									title: item.recipe.title,
									yieldAmount: item.recipe.yieldAmount,
									yieldLabel: item.recipe.yieldLabel,
									image: item.recipe.image,
								}
							: null
					return {
						id: item.id,
						kind: item.kind,
						recipeTitle: item.recipeTitle,
						scaleMultiplier: item.scaleMultiplier,
						note: item.note,
						recipe,
						shoppingLines: item.shoppingLines,
					}
				}),
			})),
		},
		// Add to Plan's default date, the browser's day (see getRequestToday).
		today: getRequestToday(request),
	}
}

/**
 * Add to Plan: copy this Menu into ONE stable Meal snapshot, with section
 * order, Recipe and note cards, display identity, multipliers, display notes,
 * and note Shopping lines all frozen by value. Later Menu edits never change
 * the Meal. The Meal records sourceMenuId and the Menu's updatedAt.
 */
export async function action({ request, params }: Route.ActionArgs) {
	const { householdId } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	invariantResponse(
		formData.get('intent') === 'planMenu',
		'Unsupported action',
		{
			status: 400,
		},
	)

	const submission = parseWithZod(formData, { schema: PlanMenuSchema })
	if (submission.status !== 'success') {
		return data({ result: submission.reply() }, { status: 400 })
	}
	const { date, label, time, timeZone, guestCount } = submission.value

	// Serving time is one UTC instant plus the IANA zone it was set in,
	// computed from the Meal's semantic date. Guest count is context only.
	const servingAt =
		time != null ? servingInstantFromWallTime(date, time, timeZone!) : null
	const result = await planMenu(prisma, {
		householdId,
		menuId: params.menuId,
		date,
		label: label ?? null,
		servingAt,
		servingTimeZone: servingAt ? (timeZone ?? null) : null,
		guestCount: guestCount ?? null,
	})
	if (!result.created) {
		return data(
			{
				result: submission.reply({
					formErrors: [EMPTY_MENU_MESSAGE],
				}),
			},
			{ status: 400 },
		)
	}

	return redirect(`/plan?weekStart=${serializeDate(getWeekStart(date))}`)
}

const fieldLabel =
	'text-muted-foreground phone:text-label phone:mb-1.5 phone:font-semibold mb-1 block text-xs font-medium'

/**
 * The Add to Plan panel: date plus optional label, serving time, and guest
 * count. Guest count is prefilled from the Menu's default as context. It
 * never scales quantities, and multipliers copy unchanged.
 */
function AddToPlanPanel({
	defaultDate,
	defaultGuestCount,
	errors,
	onCancel,
	inSheet = false,
}: {
	/** The user's today, `yyyy-MM-dd`. */
	defaultDate: string
	defaultGuestCount: number | null
	errors: string[]
	onCancel: () => void
	/** A sheet brings its own frame and Close and puts the action full width. */
	inSheet?: boolean
}) {
	// The instant is named by wall time plus the browser's IANA zone; the zone
	// travels in a hidden input so the server can store the pair.
	const [timeZone] = useState(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
	)
	// Full-page POST with no server-side dedupe. A double-click would plan
	// the Menu twice, so the submit locks while the navigation is in flight.
	const navigation = useNavigation()
	const submitting = navigation.state !== 'idle'

	return (
		<Form
			method="POST"
			className={cn(
				!inSheet &&
					'border-border/60 bg-card phone:mt-5 mt-4 rounded-lg border p-4',
			)}
		>
			<input type="hidden" name="intent" value="planMenu" />
			<input type="hidden" name="timeZone" value={timeZone} />
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div className="col-span-2 sm:col-span-1">
					<label htmlFor="plan-date" className={fieldLabel}>
						Date
					</label>
					<Input
						id="plan-date"
						type="date"
						name="date"
						required
						defaultValue={defaultDate}
					/>
				</div>
				<div>
					<label htmlFor="plan-label" className={fieldLabel}>
						Label
					</label>
					<select
						id="plan-label"
						name="label"
						defaultValue=""
						className="border-input bg-background h-11 w-full rounded-md border px-3 text-base md:text-sm"
					>
						<option value="">No label</option>
						{MEAL_TYPES.map((type) => (
							<option key={type} value={type}>
								{MEAL_TYPE_LABELS[type]}
							</option>
						))}
					</select>
				</div>
				<div>
					<label htmlFor="plan-time" className={fieldLabel}>
						Serving time
					</label>
					<Input id="plan-time" type="time" name="time" />
				</div>
				<div>
					<label htmlFor="plan-guests" className={fieldLabel}>
						Guests
					</label>
					<Input
						id="plan-guests"
						type="number"
						inputMode="numeric"
						enterKeyHint="done"
						name="guestCount"
						min={1}
						max={999}
						defaultValue={defaultGuestCount ?? ''}
					/>
				</div>
			</div>
			<p className="text-muted-foreground phone:text-label phone:mt-3 mt-2 text-xs">
				Recipe multipliers copy from this Menu and remain manually editable in
				Plan.
			</p>
			{errors.length > 0 ? (
				<ul className="text-foreground-destructive phone:text-label mt-2 space-y-0.5 text-sm">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			) : null}
			{inSheet ? (
				<Button
					type="submit"
					className="phone:h-12 phone:font-semibold mt-4 w-full"
					disabled={submitting}
				>
					<Icon name="calendar" size="sm" className="phone:size-5" />
					{submitting ? 'Adding…' : 'Add to Plan'}
				</Button>
			) : (
				<div className="mt-3 flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="phone:text-base"
						onClick={onCancel}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						className="phone:text-base"
						disabled={submitting}
					>
						<Icon name="calendar" size="sm" />
						{submitting ? 'Adding…' : 'Add to Plan'}
					</Button>
				</div>
			)}
		</Form>
	)
}

export default function MenuDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { menu } = loaderData
	const today = loadedToday(loaderData.today)
	const [planning, setPlanning] = useState(false)
	const [planFormDismissed, setPlanFormDismissed] = useState(false)
	// On a phone the form is a bottom sheet; wider, it opens in place.
	const [planInSheet, setPlanInSheet] = useState(false)
	const planResult =
		actionData != null && 'result' in actionData ? actionData.result : undefined
	// A failed full-page POST re-renders with actionData. Keep the panel open
	// so its errors are visible, until the user cancels.
	const showPlanPanel = planning || (planResult != null && !planFormDismissed)
	const planErrors = planResult?.error
		? [
				...new Set(
					Object.values(planResult.error)
						.flat()
						.filter(
							(error): error is string =>
								typeof error === 'string' && Boolean(error),
						),
				),
			]
		: []
	function closePlanForm() {
		setPlanning(false)
		setPlanFormDismissed(true)
	}
	// The nav bar's Share and Edit go when the page does (an error after load).
	useNavBarActions(MenuBarActions)
	const handleShare = useShareMenu(menu)
	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="phone:text-menu-title phone:break-words font-serif text-2xl">
				{menu.title}
			</h1>

			{menu.defaultGuestCount ? (
				<p className="text-muted-foreground phone:text-label phone:mt-2 mt-1 flex items-center gap-1.5 text-sm">
					<Icon name="avatar" size="xs" />
					Usually for {menu.defaultGuestCount} guests
				</p>
			) : null}

			{menu.description && (
				<p className="text-muted-foreground phone:mt-2 phone:break-words mt-3 leading-relaxed">
					{menu.description}
				</p>
			)}

			{/* One primary action. On a phone it is the one full-width button and
			    Share and Edit are in the nav bar; wider, they stay quiet beside
			    it, the same shape as the Recipe action bar. While the form is
			    open in place the button is gone, so on a phone the row, which
			    would be empty, goes too. */}
			<div
				className={cn(
					'phone:mt-5 mt-4 flex items-center gap-1',
					showPlanPanel && !planInSheet && 'phone:hidden',
				)}
			>
				{(!showPlanPanel || planInSheet) && (
					<Button
						// From 640px the button keeps its own width, except on a
						// phone's screen, where it fills the row.
						className="phone:h-12 phone:font-semibold not-phone:sm:flex-none flex-1"
						onClick={() => {
							setPlanInSheet(opensAsSheet())
							setPlanning(true)
							setPlanFormDismissed(false)
						}}
					>
						<Icon name="calendar" size="sm" className="phone:size-5" />
						Add to Plan
					</Button>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Share"
							className="phone:hidden"
							onClick={handleShare}
						>
							<Icon name="share" size="md" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Share</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							asChild
							variant="ghost"
							size="icon"
							aria-label="Edit"
							className="phone:hidden"
						>
							<PushLink to={`/recipes/menus/${menu.id}/edit`}>
								<Icon name="pencil-1" size="md" />
							</PushLink>
						</Button>
					</TooltipTrigger>
					<TooltipContent>Edit Menu</TooltipContent>
				</Tooltip>
			</div>

			{showPlanPanel && !planInSheet && (
				<AddToPlanPanel
					defaultDate={today}
					defaultGuestCount={menu.defaultGuestCount}
					errors={planErrors}
					onCancel={closePlanForm}
				/>
			)}
			{planInSheet && (
				<BottomSheet
					open={showPlanPanel}
					onClose={closePlanForm}
					labelledBy="menu-plan-sheet-title"
					title="Add to Plan"
					description={menu.title}
				>
					<AddToPlanPanel
						defaultDate={today}
						defaultGuestCount={menu.defaultGuestCount}
						errors={planErrors}
						onCancel={closePlanForm}
						inSheet
					/>
				</BottomSheet>
			)}

			<MenuContents menu={menu} />
		</div>
	)
}

export function ErrorBoundary() {
	return <NotInHouseholdBoundary kind="Menu" />
}
