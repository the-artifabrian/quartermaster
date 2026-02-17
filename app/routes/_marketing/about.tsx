import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { type Route } from './+types/about.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'about', priority: 0.3 }],
}

const description =
	'Quartermaster started from a familiar frustration: recipes scattered everywhere and no idea what\u2019s for dinner. So we built one place for your recipes, your pantry, and your week.'

export const meta: Route.MetaFunction = ({ matches }) => {
	return [
		{ title: 'About | Quartermaster' },
		{ name: 'description', content: description },
		{ property: 'og:title', content: 'About | Quartermaster' },
		{ property: 'og:description', content: description },
		...baseMetaTags(matches),
	]
}

export function loader() {
	return data(null, {
		headers: { 'Cache-Control': 'public, max-age=300' },
	})
}

export const headers: Route.HeadersFunction = pipeHeaders

export default function AboutRoute() {
	return (
		<div className="container max-w-2xl py-12">
			<h1 className="text-3xl font-bold tracking-tight">About Quartermaster</h1>

			<div className="text-muted-foreground mt-6 space-y-4 text-base/7">
				<p>
					Quartermaster started from a familiar frustration: recipes scattered
					across bookmarks, screenshots, notes apps, and half-remembered
					conversations. "What should we have for dinner?" shouldn't be a
					30-minute research project.
				</p>
				<p>
					So we built the tool we wanted — one place for your recipes, your
					pantry, your meal plan, and your shopping list. The idea is
					straightforward: if you know what you have and what you like to cook,
					the rest should take care of itself. Quartermaster tells you what you
					can make tonight, helps you plan the week ahead, and writes your
					shopping list when you're ready.
				</p>
				<p>
					It's built for people who actually cook at home — not food bloggers or
					professional chefs, just anyone who wants to spend less time figuring
					out meals and more time eating them.
				</p>
			</div>

			<h2 className="mt-10 text-xl font-semibold">What you can do</h2>
			<div className="mt-4 space-y-3">
				<div className="flex gap-3">
					<Icon
						name="file-text"
						className="text-primary mt-0.5 size-5 shrink-0"
					/>
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Store recipes</span> —
						Import from URLs, bulk-import from Apple Notes or text files, or
						build from scratch with ingredients, instructions, tags, and photos.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="home" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">
							Track your kitchen
						</span>{' '}
						— Keep a running inventory of what's in your pantry, fridge, and
						freezer with expiration tracking and low-stock alerts.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon
						name="magnifying-glass"
						className="text-primary mt-0.5 size-5 shrink-0"
					/>
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">
							Discover what to cook
						</span>{' '}
						— See which recipes you can make with what you already have, ranked
						by match percentage. Get suggestions for expiring ingredients before
						they go to waste.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="clock" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Plan and shop</span> —
						Plan meals for the week with ingredient overlap analysis. Generate a
						consolidated shopping list grouped by store section, minus what you
						already have.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="avatar" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Cook together</span> —
						Invite your partner or housemates to share a recipe library,
						inventory, and meal plan. Changes sync in real time with activity
						notifications.
					</p>
				</div>
			</div>

			<h2 className="mt-10 text-xl font-semibold">Built for messy hands</h2>
			<p className="text-muted-foreground mt-3 text-base/7">
				Most recipe apps are great for browsing but terrible for actually
				cooking. Quartermaster is the opposite — tap ingredients and steps to
				cross them off, start timers right from recipe instructions, scale
				servings on the fly, and your screen stays awake so you're not unlocking
				your phone with floury fingers. It works offline too.
			</p>

			<div className="mt-10">
				<Button asChild size="lg">
					<Link to="/signup">Get Started</Link>
				</Button>
			</div>
		</div>
	)
}
