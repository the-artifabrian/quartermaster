import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { type Route } from './+types/support.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'support', priority: 0.3 }],
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Support | Quartermaster' }]
}

export function loader() {
	return data(null, {
		headers: { 'Cache-Control': 'public, max-age=300' },
	})
}

export const headers: Route.HeadersFunction = pipeHeaders

export default function SupportRoute() {
	return (
		<div className="container max-w-2xl py-12">
			<h1 className="text-3xl font-bold tracking-tight">Support</h1>
			<p className="text-muted-foreground mt-3 text-base/7">
				Need help with Quartermaster? Here are a few ways to get answers.
			</p>

			<div className="mt-8 space-y-4">
				<div className="bg-muted/50 rounded-xl p-5">
					<div className="flex gap-3">
						<Icon
							name="question-mark-circled"
							className="text-primary mt-0.5 size-5 shrink-0"
						/>
						<div>
							<h2 className="font-semibold">Common questions</h2>
							<dl className="text-muted-foreground mt-3 space-y-3 text-sm">
								<div>
									<dt className="text-foreground font-medium">
										How do I import recipes?
									</dt>
									<dd className="mt-0.5">
										Several ways: paste a URL and Quartermaster extracts the
										recipe automatically, bulk-import by pasting text from
										Apple Notes (separate recipes with ---), or drag and drop
										.md/.txt files. You can also import a full data export from
										Settings &gt; Data.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										How does "Discover" know what I can make?
									</dt>
									<dd className="mt-0.5">
										It compares your inventory against recipe ingredients using
										smart matching that understands different names for the same
										thing (like cilantro and coriander), then ranks recipes by
										how many ingredients you already have. It also highlights
										recipes that use ingredients about to expire.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										Can I share with my partner or household?
									</dt>
									<dd className="mt-0.5">
										Yes. Go to Settings &gt; Household to invite members via a
										link. Everyone in the household shares the same recipe
										library, inventory, meal plans, and shopping lists, with
										real-time activity notifications.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										Can I export my data?
									</dt>
									<dd className="mt-0.5">
										Yes. Go to Settings &gt; Data to export all your data
										(recipes, inventory, meal plans, shopping lists, cooking
										logs) as JSON. You can also import this export back in — your
										data is never locked in.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										How does meal planning work?
									</dt>
									<dd className="mt-0.5">
										The Planner shows a weekly calendar where you assign recipes
										to meal slots. Quartermaster analyzes ingredient overlap
										across your planned meals and suggests recipes that share
										ingredients to reduce waste. When you're ready, generate a
										shopping list that subtracts what you already have.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										How do I delete my account?
									</dt>
									<dd className="mt-0.5">
										Go to Settings &gt; Profile where you can manage your
										account. You can export all your data first from
										Settings &gt; Data.
									</dd>
								</div>
							</dl>
						</div>
					</div>
				</div>
			</div>

			<div className="mt-8">
				<Link
					to="/"
					className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
				>
					<Icon name="arrow-left" size="sm" />
					Back to home
				</Link>
			</div>
		</div>
	)
}
