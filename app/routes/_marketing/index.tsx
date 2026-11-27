import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type MouseEvent, type ReactNode } from 'react'
import { data, Link, redirect, useLoaderData } from 'react-router'
import { TryDemoButton } from '#app/components/demo.tsx'
import {
	GuestsPlanPhone,
	RecipePhone,
	ShoppingPhone,
	StaplesPhone,
	TodayPlanPhone,
} from '#app/components/homepage-phones.tsx'
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
			{/* Same order as the subhead: Recipes, a week, minus Staples, a list. */}
			<FeatureBand
				index={1}
				id="how-it-works"
				heading="Your Recipes, in one place"
				body="Paste a link or the text of a Recipe, or type one in. Scale up for guests and check off ingredients as you cook."
				screenSide="left"
				screen={<RecipePhone />}
			/>
			<FeatureBand
				index={2}
				heading="A week pencilled in"
				body="Add Recipes to the week and group dishes into Meals. Move a Meal to another day when plans change."
				screenSide="right"
				screen={<GuestsPlanPhone today={today} />}
			/>
			<FeatureBand
				index={3}
				heading="Minus what you already have"
				body="Add the Staples you usually have. Shopping leaves them out, and one tap puts any of them back on the list."
				screenSide="left"
				screen={<StaplesPhone />}
			/>
			<FeatureBand
				index={4}
				heading="Pick what you’ll buy"
				body="Open From Plan, tick the Meals you’re shopping for, and only those lines land on the list."
				screenSide="right"
				screen={<ShoppingPhone />}
			/>
			<ClosingCta />
		</div>
	)
}

function Hero({ today }: { today: string }) {
	// The iOS app shows no copy about Pro or its trial (ADR 0001).
	const isNativeShell = useIsNativeShell()
	return (
		<section className="container pt-10 pb-14 sm:pt-16 sm:pb-20 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-10 lg:gap-16 lg:pb-24">
			<div className="max-w-[36rem]">
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

			<div className="mt-12 flex justify-center md:mt-0">
				<TodayPlanPhone today={today} />
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

function FeatureBand({
	index,
	id,
	heading,
	body,
	screenSide,
	screen,
}: {
	index: number
	id?: string
	heading: string
	body: string
	screenSide: 'left' | 'right'
	screen: ReactNode
}) {
	// Every other band sits on the quiet fill, so the bands read apart.
	const filled = index % 2 === 0
	return (
		<section className={cn('py-16 sm:py-24 lg:py-28', filled && 'bg-muted')}>
			{/* The anchor sits on the content, not the padded section, so "See how
			    it works" lands the band just under the header (sticky from md)
			    instead of leaving the padding as a blank gap. */}
			<div
				id={id}
				className={cn(
					'container grid scroll-mt-6 gap-10 md:scroll-mt-24 md:items-center md:justify-center lg:gap-20',
					screenSide === 'right'
						? 'md:grid-cols-[minmax(0,28rem)_auto]'
						: 'md:grid-cols-[auto_minmax(0,28rem)]',
				)}
			>
				{/* Caption first in the DOM so phones read heading, then screen. */}
				<div
					className={cn(
						'max-w-[28rem]',
						screenSide === 'right' ? 'md:order-1' : 'md:order-2',
					)}
				>
					<p className="font-serif text-2xl tabular-nums">
						{String(index).padStart(2, '0')}
					</p>
					<h2 className="mt-5 font-serif text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-balance sm:text-[3rem]">
						{heading}
					</h2>
					<p className="text-muted-foreground mt-6 text-lg leading-[1.55] sm:text-xl">
						{body}
					</p>
				</div>
				<div
					className={cn(
						'flex min-w-0 justify-center',
						screenSide === 'right' ? 'md:order-2' : 'md:order-1',
					)}
				>
					{screen}
				</div>
			</div>
		</section>
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
