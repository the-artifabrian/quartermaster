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
	'I had 100+ recipes scattered across Apple Notes and no idea what was for dinner. So I built one place for my recipes, my Staples, and my week.'

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
			<h1 className="font-serif text-[2.25rem] leading-[1.15] tracking-[-0.02em]">
				About Quartermaster
			</h1>

			<div className="text-muted-foreground mt-6 space-y-4 text-base/7">
				<p>
					I had 100+ recipes scattered across bookmarks, screenshots, Apple
					Notes, and half-remembered conversations. "What should we have for
					dinner?" shouldn't be a 30-minute research project every night.
				</p>
				<p>
					So I built the tool I wanted. One place for your recipes, your
					Staples, your meal plan, and your shopping list. Quartermaster helps
					you choose a Recipe, plan the week, and write Shopping when you're
					ready.
				</p>
				<p>
					It's built for people who actually cook at home, not food bloggers or
					professional chefs. Just anyone who'd rather eat than plan.
				</p>
			</div>

			<h2 className="mt-10 font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
				What you can do
			</h2>
			<div className="mt-4 space-y-3">
				<div className="flex gap-3">
					<Icon
						name="file-text"
						className="text-primary mt-0.5 size-5 shrink-0"
					/>
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Store recipes.</span>{' '}
						Import from a URL, paste text, or upload screenshots. You can also
						write a Recipe with ingredients, instructions, and a photo.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="home" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Keep Staples.</span>{' '}
						Save the ingredients your household normally has and mark anything
						Out. Shopping includes every non-Staple plus required Out Staples.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon
						name="magnifying-glass"
						className="text-primary mt-0.5 size-5 shrink-0"
					/>
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">
							Check what to buy.
						</span>{' '}
						See what a Recipe would add to Shopping before you plan it.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="clock" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Plan and shop.</span>{' '}
						Plan meals for the week. Quartermaster spots shared ingredients
						across meals and builds one shopping list.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="avatar" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Cook together.</span>{' '}
						Invite your partner or housemates to share a recipe library,
						Staples, and meal plan. Changes sync in real time.
					</p>
				</div>
			</div>

			<h2 className="mt-10 font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
				Built for messy hands
			</h2>
			<p className="text-muted-foreground mt-3 text-base/7">
				Most recipe apps are great for browsing but terrible for actually
				cooking. Quartermaster is the opposite: tap ingredients and steps to
				cross them off, spot cooking times and temperatures at a glance, and
				scale ingredient quantities on the fly.
			</p>

			<div className="mt-10">
				<Button asChild size="lg">
					<Link to="/signup">Get started</Link>
				</Button>
			</div>
		</div>
	)
}
