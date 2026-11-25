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
	'I built Quartermaster because 100 recipes in Apple Notes is not a meal plan. My partner and I use it every day.'

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
					I built Quartermaster because 100 recipes in Apple Notes is not a meal
					plan. My partner and I use it every day on our phones.
				</p>
				<p>
					We put the week&apos;s dinners on the Plan, and when it&apos;s time to
					shop, their ingredients land on one list.
				</p>
				<p>
					It&apos;s also my portfolio project. The code is open source, and you
					can{' '}
					<a
						href="https://github.com/the-artifabrian/quartermaster"
						className="text-foreground underline underline-offset-2"
					>
						read it on GitHub
					</a>
					.
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
						<span className="text-foreground font-medium">Keep Recipes.</span>{' '}
						Import one from a link, pasted text or a screenshot, or write your
						own with a photo.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="home" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Keep Staples.</span>{' '}
						Save the ingredients your Household normally has. They start
						unticked in From Plan, and any one of them goes on Shopping with a
						tap.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="cart" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">
							Shop one ingredient.
						</span>{' '}
						Out of one thing a Recipe needs? Tap it on the Recipe and it lands
						on Shopping, Staple or not.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="clock" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Plan and shop.</span>{' '}
						Plan Meals for the week. Quartermaster spots shared ingredients
						across Meals and adds each to Shopping once.
					</p>
				</div>
				<div className="flex gap-3">
					<Icon name="avatar" className="text-primary mt-0.5 size-5 shrink-0" />
					<p className="text-muted-foreground text-sm">
						<span className="text-foreground font-medium">Cook together.</span>{' '}
						Invite your partner or housemates to share Recipes, Staples, the
						Plan and Shopping. On Pro, Shopping updates live on every phone.
					</p>
				</div>
			</div>

			<div className="mt-10">
				<Button asChild size="lg">
					<Link to="/signup">Get started</Link>
				</Button>
			</div>
		</div>
	)
}
