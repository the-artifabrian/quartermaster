import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { type Route } from './+types/about.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'about', priority: 0.3 }],
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'About | Quartermaster' }]
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
					Quartermaster is a recipe management app built to replace recipes
					scattered across notes apps, bookmarks, and screenshots. It puts your
					entire cooking life in one place: recipes, pantry inventory, meal
					plans, and shopping lists.
				</p>
				<p>
					The idea is simple — if you know what recipes you have and what
					ingredients are in your kitchen, the app can tell you what you can
					cook right now, help you plan your week, and generate a shopping list
					for what you're missing. After you cook, it updates your inventory
					automatically so you're always ready for next time.
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
						<span className="text-foreground font-medium">Store recipes</span>{' '}
						— Import from URLs, bulk-import from Apple Notes or text files,
						or build from scratch with ingredients, instructions, tags, and
						photos.
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
						<span className="text-foreground font-medium">Plan and shop</span>{' '}
						— Plan meals for the week with ingredient overlap analysis.
						Generate a consolidated shopping list grouped by store section, minus
						what you already have.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon
						name="avatar"
						className="text-primary mt-0.5 size-5 shrink-0"
					/>
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">
							Cook together
						</span>{' '}
						— Invite your partner or housemates to share a recipe library,
						inventory, and meal plan. Changes sync in real time with activity
						notifications.
					</p>
				</div>
			</div>

			<h2 className="mt-10 text-xl font-semibold">Built for the kitchen</h2>
			<p className="text-muted-foreground mt-3 text-base/7">
				Quartermaster is designed to be used while you cook. Tap ingredients
				and steps to cross them off, start inline timers from recipe
				instructions, scale servings up or down, and keep your screen awake so
				you don't have to touch your phone with messy hands. It works offline
				too — recipes you've viewed are available without a connection.
			</p>

			<div className="mt-10">
				<Button asChild size="lg">
					<Link to="/signup">Get Started</Link>
				</Button>
			</div>
		</div>
	)
}
