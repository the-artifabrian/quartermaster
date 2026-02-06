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
										How do I import a recipe from a website?
									</dt>
									<dd className="mt-0.5">
										Go to Recipes, click "Import from URL", paste the link, and
										Quartermaster will extract the recipe details automatically.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										How does "Discover" know what I can make?
									</dt>
									<dd className="mt-0.5">
										It compares your inventory against recipe ingredients using
										fuzzy matching and synonym lookup, then ranks recipes by
										match percentage.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										Can I export my recipes?
									</dt>
									<dd className="mt-0.5">
										Yes. Each recipe has a JSON export option on the edit page.
									</dd>
								</div>
								<div>
									<dt className="text-foreground font-medium">
										How do I delete my account?
									</dt>
									<dd className="mt-0.5">
										Contact us using the information below and we'll delete your
										account and all associated data.
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
