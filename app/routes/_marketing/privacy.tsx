import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { type Route } from './+types/privacy.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'privacy', priority: 0.2 }],
}

const description =
	'What Quartermaster collects, how we use it, and how to export or delete everything. Short version: your data is yours.'

export const meta: Route.MetaFunction = ({ matches }) => {
	return [
		{ title: 'Privacy Policy | Quartermaster' },
		{ name: 'description', content: description },
		{ property: 'og:title', content: 'Privacy Policy | Quartermaster' },
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

export default function PrivacyRoute() {
	return (
		<div className="container max-w-2xl py-12">
			<h1 className="font-serif text-[2.25rem] leading-[1.15] tracking-[-0.02em]">Privacy Policy</h1>
			<p className="text-muted-foreground mt-2 text-sm">
				Last updated: March 2026
			</p>

			<div className="mt-8 space-y-6 text-sm/6">
				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">What we collect</h2>
					<p className="text-muted-foreground mt-2">
						Quartermaster collects the minimum data needed to provide the
						service: your email address, username, and password (hashed) for
						authentication, plus the recipes, inventory items, and meal plans
						you create.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">How we use your data</h2>
					<p className="text-muted-foreground mt-2">
						Your data is used solely to provide and improve the Quartermaster
						service. We use PostHog for product analytics to understand how
						features are used and to fix bugs. We do not sell your data or use
						it for advertising.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">Analytics and session replay</h2>
					<p className="text-muted-foreground mt-2">
						Quartermaster uses PostHog to capture anonymous pageviews, clicks,
						and session recordings (DOM snapshots — visible page text is
						recorded, but form input values are masked by default). This helps
						us understand usage patterns and diagnose issues. You can opt out at any time by running{' '}
						<code className="bg-muted rounded px-1 py-0.5 text-xs">
							posthog.opt_out_capturing()
						</code>{' '}
						in your browser console.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">Data storage</h2>
					<p className="text-muted-foreground mt-2">
						Your data is stored in a SQLite database hosted on Fly.io
						infrastructure. Recipe images are stored in S3-compatible object
						storage. All connections use HTTPS encryption in transit.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">Cookies</h2>
					<p className="text-muted-foreground mt-2">
						We use a single httpOnly session cookie for authentication and a
						theme preference cookie. PostHog sets an analytics cookie for
						identified users (only created after you log in, per our{' '}
						<code className="bg-muted rounded px-1 py-0.5 text-xs">
							person_profiles: &apos;identified_only&apos;
						</code>{' '}
						configuration). We do not use advertising cookies.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">Data export and deletion</h2>
					<p className="text-muted-foreground mt-2">
						You can export all your data (recipes, inventory, meal plans,
						shopping lists) as JSON at any time. Go to Settings &gt; Profile
						to manage your account.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">Changes</h2>
					<p className="text-muted-foreground mt-2">
						We may update this policy as the service evolves. Significant
						changes will be communicated through the app.
					</p>
				</section>
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
