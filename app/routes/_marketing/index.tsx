import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef } from 'react'
import { data, Link, redirect } from 'react-router'
import { Divider } from '#app/components/divider.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { getUserId } from '#app/utils/auth.server.ts'
import { cn } from '#app/utils/misc.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { type Route } from './+types/index.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: '', priority: 1.0 }],
}

const description =
	'Keep your recipes. Plan your week. Cook from what you have.'

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: 'Quartermaster' },
	{ name: 'description', content: description },
	{ property: 'og:title', content: 'Quartermaster' },
	{ property: 'og:description', content: description },
	...baseMetaTags(matches),
]

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await getUserId(request)
	if (userId) {
		throw redirect('/recipes')
	}
	return data(null)
}

export const headers: Route.HeadersFunction = pipeHeaders

const webApplicationJsonLd = JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'WebApplication',
	name: 'Quartermaster',
	description,
	applicationCategory: 'LifestyleApplication',
	operatingSystem: 'Web',
	offers: {
		'@type': 'Offer',
		price: '0',
		priceCurrency: 'USD',
	},
}).replace(/</g, '\\u003c')

export default function Index() {
	return (
		<div>
			{/* Static JSON-LD structured data (no user input) */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: webApplicationJsonLd }}
			/>

			{/* Hero */}
			<section className="relative flex min-h-[60svh] flex-col items-center justify-center px-4 pt-12 pb-8 md:pt-16 md:pb-12">
				{/* Warm radial glow */}
				<div
					className="pointer-events-none absolute inset-0"
					style={{
						background:
							'radial-gradient(ellipse 80% 60% at 50% 40%, var(--accent) 0%, transparent 70%)',
						opacity: 0.12,
					}}
				/>
				<div
					className="relative text-center"
					style={{
						animation: '320ms var(--ease-page-settle) both fade-up-reveal',
					}}
				>
					<h1 className="text-foreground font-serif text-[2.5rem] leading-[1.2] tracking-[-0.02em] md:text-[3.5rem]">
						What are we making
						<br />
						this week?
					</h1>
					<p className="text-muted-foreground mx-auto mt-6 max-w-lg text-lg/7">
						Your recipes, your pantry, your meal plan, your shopping list — one
						place that closes the loop so dinner answers itself.
					</p>

					{/* Decorative divider */}
					<div className="mx-auto mt-8 max-w-[200px]">
						<Divider variant="accent" />
					</div>

					<div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
						<Button asChild size="lg" className="rounded-full px-8">
							<Link to="/signup">Start cooking</Link>
						</Button>
						<Button
							asChild
							variant="ghost"
							size="lg"
							className="text-muted-foreground rounded-full"
						>
							<a href="#glimpse">See how it works</a>
						</Button>
					</div>
					<p className="text-muted-foreground/70 mt-4 text-sm">
						Free for 14 days. No credit card needed.
					</p>
				</div>
			</section>

			{/* Pipeline — four artifacts that tell the loop story */}
			<section id="glimpse" className="container-landing py-16 md:py-24">
				<div className="space-y-20 md:space-y-32">
					{/* 1. Recipe collection — left on desktop */}
					<ScrollReveal className="flex flex-col items-center gap-10 md:flex-row">
						<div className="w-full max-w-[340px] shrink-0 rotate-[-2deg]">
							<RecipeCardArtifact />
						</div>
						<div className="text-center md:text-left">
							<h2 className="font-serif text-2xl font-normal md:text-3xl">
								Your recipes, all in one place
							</h2>
							<p className="text-muted-foreground mt-3 text-base/7">
								Paste a URL, import dozens from Apple Notes, or type one in
								by hand. Every recipe is searchable, scalable, and ready to
								cook — no more digging through bookmarks and screenshots.
							</p>
						</div>
					</ScrollReveal>

					{/* 2. Discovery / matching — right on desktop, warm band */}
					<div className="-mx-4 bg-secondary/30 px-4 py-10 sm:-mx-8 sm:px-8 md:py-14">
						<ScrollReveal className="container-landing flex flex-col items-center gap-10 md:flex-row-reverse">
							<div className="w-full max-w-[340px] shrink-0 rotate-[1.5deg]">
								<DiscoveryArtifact />
							</div>
							<div className="text-center md:text-right">
								<h2 className="font-serif text-2xl font-normal md:text-3xl">
									What can I make tonight?
								</h2>
								<p className="text-muted-foreground mt-3 text-base/7">
									Tell Quartermaster what's in your kitchen and it shows
									which recipes you can cook right now — ranked by how many
									ingredients you already have. No more staring at the fridge.
								</p>
							</div>
						</ScrollReveal>
					</div>

					{/* 3. Meal planning — left on desktop */}
					<ScrollReveal className="flex flex-col items-center gap-10 md:flex-row">
						<div className="w-full max-w-[400px] shrink-0 rotate-[-1deg]">
							<WeekViewArtifact />
						</div>
						<div className="text-center md:text-left">
							<h2 className="font-serif text-2xl font-normal md:text-3xl">
								A week penciled in
							</h2>
							<p className="text-muted-foreground mt-3 text-base/7">
								Add recipes to a weekly calendar. Adjust servings, swap
								meals around, or ask for suggestions that use overlapping
								ingredients so nothing goes to waste.
							</p>
						</div>
					</ScrollReveal>

					{/* 4. Shopping list — right on desktop, warm band */}
					<div className="-mx-4 bg-secondary/30 px-4 py-10 sm:-mx-8 sm:px-8 md:py-14">
						<ScrollReveal className="container-landing flex flex-col items-center gap-10 md:flex-row-reverse">
							<div className="w-full max-w-[280px] shrink-0 rotate-[1deg]">
								<ShoppingListArtifact />
							</div>
							<div className="text-center md:text-right">
								<h2 className="font-serif text-2xl font-normal md:text-3xl">
									The list writes itself
								</h2>
								<p className="text-muted-foreground mt-3 text-base/7">
									One tap generates a shopping list from your meal plan.
									Items you already have are pre-checked. Check things off
									at the store and they flow back into your pantry — closing
									the loop for next week.
								</p>
							</div>
						</ScrollReveal>
					</div>
				</div>
			</section>

			{/* Feature strip — compact grid */}
			<section className="container-landing py-16 md:py-20">
				<div className="grid gap-8 sm:grid-cols-3 sm:gap-12">
					<div className="text-center">
						<p className="font-serif text-lg">Built for the kitchen</p>
						<p className="text-muted-foreground mt-2 text-sm/6">
							Tap ingredients to cross them off. Start timers from recipe
							steps. Scale servings on the fly — all designed for when your
							hands are busy.
						</p>
					</div>
					<div className="text-center">
						<p className="font-serif text-lg">Cook together</p>
						<p className="text-muted-foreground mt-2 text-sm/6">
							Share your recipe library, meal plan, and shopping list with
							your household. Changes sync in real time so you're always on
							the same page.
						</p>
					</div>
					<div className="text-center">
						<p className="font-serif text-lg">Your data is yours</p>
						<p className="text-muted-foreground mt-2 text-sm/6">
							Export everything as JSON anytime. No lock-in, no data
							hostage. Import it right back if you ever need to.
						</p>
					</div>
				</div>
			</section>

			{/* Close */}
			<section className="bg-secondary/40 px-4 py-20 text-center md:py-28">
				<div className="mx-auto max-w-[200px]">
					<Divider variant="accent" />
				</div>
				<h2 className="mt-8 font-serif text-[1.75rem] font-normal md:text-[2.25rem]">
					Your recipes deserve a home.
				</h2>
				<p className="text-muted-foreground mx-auto mt-4 max-w-sm text-base/7">
					Try everything free for 14 days. Keep your recipes forever on the
					free plan.
				</p>
				<div className="mt-8">
					<Button asChild size="lg" className="rounded-full px-8">
						<Link to="/signup">Start cooking</Link>
					</Button>
				</div>
			</section>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Scroll-reveal wrapper
// ---------------------------------------------------------------------------

function ScrollReveal({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		// Skip animation if user prefers reduced motion
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			el.classList.remove('opacity-0')
			return
		}

		el.style.transform = 'translateY(24px)'
		el.style.transition =
			'opacity 280ms var(--ease-reveal), transform 280ms var(--ease-reveal)'

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					el.classList.remove('opacity-0')
					el.style.transform = 'translateY(0)'
					observer.unobserve(el)
				}
			},
			{ threshold: 0.15 },
		)

		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	return (
		<div ref={ref} className={cn('opacity-0', className)}>
			{children}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

function RecipeCardArtifact() {
	return (
		<div className="bg-card rounded-lg border p-5 shadow-warm-md">
			<p className="font-handwritten mb-3 text-[20px] font-bold text-accent">
				Tonight's dinner
			</p>
			{/* Large serif initial on warm background */}
			<div className="bg-secondary flex aspect-[4/3] items-center justify-center rounded">
				<span className="text-accent/25 font-serif text-8xl select-none">
					M
				</span>
			</div>
			<h3 className="mt-4 font-serif text-lg">Miso-Glazed Salmon</h3>
			<p className="text-muted-foreground mt-1 text-sm">
				25 min &middot; 2 servings
			</p>
			<div className="mt-3 space-y-1.5">
				{['Salmon fillets', 'White miso', 'Mirin', 'Sesame oil'].map(
					(ing) => (
						<div
							key={ing}
							className="text-muted-foreground border-border/60 border-b pb-1.5 text-sm last:border-0"
						>
							{ing}
						</div>
					),
				)}
			</div>
		</div>
	)
}

function DiscoveryArtifact() {
	const recipes = [
		{ name: 'Pasta al limone', match: 100 },
		{ name: 'Miso-Glazed Salmon', match: 75 },
		{ name: 'Black bean tacos', match: 50 },
	]

	return (
		<div className="bg-card rounded-lg border p-5 shadow-warm-md">
			<p className="font-handwritten mb-3 text-[20px] font-bold text-accent">
				What can I make?
			</p>
			<div className="space-y-3">
				{recipes.map(({ name, match }) => (
					<div key={name} className="flex items-center gap-3">
						<MatchRing percent={match} />
						<div className="min-w-0 flex-1">
							<p className="font-serif text-sm">{name}</p>
							<p className="text-muted-foreground text-xs">
								{match === 100
									? 'Ready to cook'
									: match >= 75
										? 'Missing 1 item'
										: 'Missing 2 items'}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function MatchRing({ percent }: { percent: number }) {
	const r = 16
	const circumference = 2 * Math.PI * r
	const offset = circumference - (percent / 100) * circumference

	return (
		<svg viewBox="0 0 40 40" className="size-10 shrink-0">
			<circle
				cx="20"
				cy="20"
				r={r}
				fill="none"
				stroke="currentColor"
				strokeWidth="3"
				className="text-secondary"
			/>
			<circle
				cx="20"
				cy="20"
				r={r}
				fill="none"
				stroke="currentColor"
				strokeWidth="3"
				strokeDasharray={circumference}
				strokeDashoffset={offset}
				strokeLinecap="round"
				className="text-primary"
				transform="rotate(-90 20 20)"
			/>
			<text
				x="20"
				y="20"
				textAnchor="middle"
				dominantBaseline="central"
				className="fill-foreground text-[10px] font-medium"
			>
				{percent}%
			</text>
		</svg>
	)
}

function WeekViewArtifact() {
	const days = [
		{ day: 'Mon', meal: 'Pasta al limone' },
		{ day: 'Tue', meal: 'Chicken tikka' },
		{ day: 'Wed', meal: '' },
		{ day: 'Thu', meal: 'Black bean tacos' },
		{ day: 'Fri', meal: 'Salmon bowl' },
		{ day: 'Sat', meal: '' },
		{ day: 'Sun', meal: 'Ramen' },
	]

	return (
		<div className="bg-card rounded-lg border p-5 shadow-warm-md">
			<p className="font-handwritten mb-3 text-[20px] font-bold text-accent">
				This week
			</p>
			<div className="grid grid-cols-7 gap-2">
				{days.map(({ day, meal }) => (
					<div key={day} className="text-center">
						<p className="text-muted-foreground mb-2 text-xs font-medium">
							{day}
						</p>
						<div className="bg-secondary/60 min-h-[52px] rounded px-1 py-2">
							{meal ? (
								<p className="text-foreground/80 font-handwritten text-[13px] leading-tight">
									{meal}
								</p>
							) : (
								<p className="text-border text-lg leading-tight">+</p>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

function ShoppingListArtifact() {
	const items = [
		{ name: 'Salmon fillets', checked: true },
		{ name: 'White miso paste', checked: true },
		{ name: 'Mirin', checked: false },
		{ name: 'Limes (3)', checked: false },
		{ name: 'Spaghetti', checked: false },
		{ name: 'Black beans', checked: true },
	]

	return (
		<div
			className="bg-card rounded-t-lg p-5 shadow-warm-md"
			style={{
				clipPath:
					'polygon(0 0, 100% 0, 100% calc(100% - 12px), 92% 100%, 84% calc(100% - 4px), 76% calc(100% - 10px), 68% 100%, 60% calc(100% - 6px), 52% calc(100% - 12px), 44% calc(100% - 2px), 36% calc(100% - 8px), 28% 100%, 20% calc(100% - 5px), 12% calc(100% - 11px), 4% calc(100% - 3px), 0 calc(100% - 8px))',
			}}
		>
			<p className="font-handwritten mb-3 text-[20px] font-bold text-accent">
				Shopping list
			</p>
			<div className="space-y-2.5">
				{items.map((item) => (
					<div key={item.name} className="flex items-center gap-2.5">
						<div
							className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
								item.checked
									? 'border-primary bg-primary'
									: 'border-muted-foreground/40'
							}`}
						>
							{item.checked ? (
								<svg viewBox="0 0 8 8" className="size-2.5">
									<path
										d="M1,4 L3,6 L7,2"
										stroke="currentColor"
										strokeWidth="1.5"
										fill="none"
										className="text-primary-foreground"
									/>
								</svg>
							) : null}
						</div>
						<span
							className={`text-sm ${
								item.checked
									? 'text-muted-foreground/50 line-through'
									: 'text-foreground'
							}`}
						>
							{item.name}
						</span>
					</div>
				))}
			</div>
			{/* Extra padding for torn edge */}
			<div className="h-4" />
		</div>
	)
}
