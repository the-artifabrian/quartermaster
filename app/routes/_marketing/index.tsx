import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type MouseEvent } from 'react'
import { data, Link, redirect, useLoaderData } from 'react-router'
import { TryDemoButton } from '#app/components/demo.tsx'
import {
	GuestsPlanPhone,
	RecipePhone,
	ShoppingPhone,
	StaplesPhone,
	TodayPlanPhone,
} from '#app/components/homepage-phones.tsx'
import { phoneScales } from '#app/components/phone-frame.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { loadedToday } from '#app/utils/date.ts'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { cn } from '#app/utils/misc.tsx'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { SITE_DESCRIPTION } from '#app/utils/site-description.ts'
import { getRequestToday } from '#app/utils/today.server.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '', priority: 1.0 }],
}

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: 'Quartermaster' },
	{ name: 'description', content: SITE_DESCRIPTION },
	{ property: 'og:title', content: 'Quartermaster' },
	{ property: 'og:description', content: SITE_DESCRIPTION },
	...baseMetaTags(matches),
]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	if (userId) {
		throw redirect('/recipes')
	}
	// The pictures of Plan show today and the coming Saturday on the
	// visitor's own calendar.
	// It comes from the loader so the server and the browser draw the same
	// days; the page isn't cached anywhere, so it is never a day behind.
	return data({ today: getRequestToday(request) })
}

export const headers: Route.HeadersFunction = pipeHeaders

const webApplicationJsonLd = JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: 'Quartermaster',
	description: SITE_DESCRIPTION,
	applicationCategory: 'LifestyleApplication',
	operatingSystem: 'Web',
	offers: {
		'@type': 'Offer',
		price: '0',
		priceCurrency: 'USD',
	},
}).replace(/</g, '\\u003c')

export default function Index() {
	const today = loadedToday(useLoaderData<typeof loader>()?.today)
	return (
		<div className="antialiased">
			{/* Static JSON-LD structured data (no user input) */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: webApplicationJsonLd }}
			/>
			<Hero today={today} />
			<HowItWorks today={today} />
			<ClosingCta />
		</div>
	)
}

function Hero({ today }: { today: string }) {
	// The iOS app shows no copy about Pro or its trial (ADR 0001).
	const isNativeShell = useIsNativeShell()
	return (
		<section className="border-border border-b">
			{/* The rule runs the page's width; the pair is cut on it. */}
			<div className="container pt-10 sm:pt-16 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8 lg:pt-0 xl:gap-16">
				<div className="max-w-[36rem] lg:self-center lg:py-16">
					<h1 className="font-serif text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-balance sm:text-[3.5rem] lg:text-[5.5rem]">
						What are we making this week?
					</h1>
					<p className="text-muted-foreground mt-6 max-w-[30rem] text-lg leading-[1.55] sm:text-xl">
						Keep the Recipes you cook and plan a few Meals for the week. Then
						Shopping fills in from the Meals you pick, minus what you already
						have.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
						<PrimaryCta />
						<TryDemoButton
							redirectTo="/"
							variant="secondary"
							className="h-12 px-6 text-base font-semibold"
						/>
						<a
							href="#how-it-works"
							onClick={glideToHowItWorks}
							className="text-primary decoration-primary/40 hover:decoration-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-base font-medium underline underline-offset-[6px] outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-offset-2"
						>
							See how it works
						</a>
					</div>
					{isNativeShell ? null : (
						<p className="text-muted-foreground mt-5 text-[15px]">
							Free to use. New accounts get 14 days of Pro.
						</p>
					)}
				</div>

				<PlanThenShop today={today} />
			</div>
		</section>
	)
}

/**
 * Plan on today in front, Shopping behind it, up and to the right with its
 * left third covered: plan, then shop. The pair is cut by the hero's bottom
 * edge, under the Plan's second Meal. A phone-width page has room for the
 * Plan alone.
 */
function PlanThenShop({ today }: { today: string }) {
	return (
		<div
			className={cn(
				phoneScales.pair,
				'relative mx-auto mt-12 h-[calc(var(--phone-scale)*600px_+_6px)] w-[calc(var(--phone-scale)*390px_+_12px)] overflow-hidden sm:h-[calc(var(--phone-scale)*740px_+_6px)] sm:w-[calc((var(--phone-scale)*390px_+_12px)*5/3)] lg:mx-0 lg:mt-16 lg:self-end',
			)}
		>
			{/* Shopping is shown, and read, as the fourth step; here it is the
			    picture's back layer. */}
			<ShoppingPhone
				scale={null}
				decorative
				className="absolute top-0 right-0 hidden sm:block"
			/>
			<TodayPlanPhone
				today={today}
				scale={null}
				className="absolute top-0 left-0 z-10 sm:top-[calc(var(--phone-scale)*140px)]"
			/>
		</div>
	)
}

const features = [
	{
		heading: 'Your Recipes, in one place',
		body: 'Paste a link or the text of a Recipe, or type one in. Scale up for guests and check off ingredients as you cook.',
		phone: 'recipe',
	},
	{
		heading: 'A week pencilled in',
		body: 'Add Recipes to the week and group dishes into Meals. Move a Meal to another day when plans change.',
		phone: 'plan',
	},
	{
		heading: 'Minus what you already have',
		body: 'Add the Staples you usually have. Shopping leaves them out, and one tap puts any of them back on the list.',
		phone: 'staples',
	},
	{
		heading: 'Pick what you’ll buy',
		body: 'Open From Plan, tick the Meals you’re shopping for, and only those lines land on the list.',
		phone: 'shopping',
	},
] as const

/** Recipes, a week, minus Staples, a list: the subhead's order, in one
 *  column on a phone, two by two from 640px and four across from 1280px. */
function HowItWorks({ today }: { today: string }) {
	const scale = phoneScales.step
	const phones = {
		recipe: <RecipePhone scale={scale} />,
		plan: <GuestsPlanPhone today={today} scale={scale} />,
		staples: <StaplesPhone scale={scale} />,
		shopping: <ShoppingPhone scale={scale} />,
	}
	return (
		<section className="py-16 sm:py-24 lg:py-28">
			{/* The anchor sits on the content, not the padded section, so "See how
			    it works" lands it just under the header (sticky from md). */}
			<div
				id="how-it-works"
				className="container grid scroll-mt-6 gap-x-6 gap-y-16 sm:grid-cols-2 md:scroll-mt-24 xl:grid-cols-4"
			>
				{features.map((feature, index) => (
					<div key={feature.heading} className="flex min-w-0 flex-col">
						<p className="font-serif text-xl tabular-nums">
							{String(index + 1).padStart(2, '0')}
						</p>
						<h2 className="mt-3 font-serif text-[1.75rem] leading-[1.15] tracking-[-0.01em] text-balance">
							{feature.heading}
						</h2>
						<p className="text-muted-foreground mt-3 text-[1.0625rem] leading-[1.55]">
							{feature.body}
						</p>
						{/* After its text, so a screen reader hears each picture with
						    its own step; once there are columns it is lifted above the
						    text. Nothing in it takes focus, so the tab order is not
						    affected. */}
						<div className="mt-8 sm:order-first sm:mt-0 sm:mb-8">
							{phones[feature.phone]}
						</div>
					</div>
				))}
			</div>
		</section>
	)
}

// The app lands every scroll; this in-page link is the one place a glide fits.
function glideToHowItWorks(event: MouseEvent<HTMLAnchorElement>) {
	const target = document.getElementById('how-it-works')
	if (!target) return
	event.preventDefault()
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
	target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' })
	history.pushState(null, '', '#how-it-works')
}

/** The app's primary button, at the Recipe page's Add to Plan height. */
function PrimaryCta() {
	return (
		<Button asChild className="h-12 px-7 text-base font-semibold">
			<Link to="/signup">Start cooking</Link>
		</Button>
	)
}

// The only centered block on the page.
function ClosingCta() {
	// The iOS app shows no copy about Pro or its trial (ADR 0001).
	const isNativeShell = useIsNativeShell()
	return (
		<section className="px-4 py-20 text-center sm:py-24 lg:py-28">
			<h2 className="mx-auto max-w-[22ch] font-serif text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[3rem]">
				Decide dinner once, for the whole week.
			</h2>
			{isNativeShell ? null : (
				<p className="text-muted-foreground mx-auto mt-5 max-w-[28rem] text-lg leading-[1.55]">
					It&apos;s free, and the first 14 days include Pro.
				</p>
			)}
			<div className="mt-9 flex justify-center">
				<PrimaryCta />
			</div>
		</section>
	)
}
