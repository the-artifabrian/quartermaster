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
				Last updated: February 2026
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
						Your data is used solely to provide the Quartermaster service to
						content. We do not use your data for advertising or analytics
						profiling.
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
						theme preference cookie. We do not use tracking cookies or
						third-party analytics.
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
