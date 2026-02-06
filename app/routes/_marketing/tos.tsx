import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data } from 'react-router'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { type Route } from './+types/tos.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'tos', priority: 0.2 }],
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Terms of Service | Quartermaster' }]
}

export function loader() {
	return data(null, {
		headers: { 'Cache-Control': 'public, max-age=300' },
	})
}

export const headers: Route.HeadersFunction = pipeHeaders

export default function TermsOfServiceRoute() {
	return (
		<div className="container max-w-2xl py-12">
			<h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
			<p className="text-muted-foreground mt-2 text-sm">
				Last updated: February 2026
			</p>

			<div className="mt-8 space-y-6 text-sm/6">
				<section>
					<h2 className="text-lg font-semibold">Using Quartermaster</h2>
					<p className="text-muted-foreground mt-2">
						Quartermaster is a personal recipe management service. By creating
						an account, you agree to use the service for its intended purpose:
						storing and organizing your recipes, tracking kitchen inventory,
						and planning meals.
					</p>
				</section>

				<section>
					<h2 className="text-lg font-semibold">Your content</h2>
					<p className="text-muted-foreground mt-2">
						You own the recipes, images, and other content you add to
						Quartermaster. We do not claim any ownership or license over your
						content beyond what is necessary to operate the service (storing,
						displaying, and backing up your data).
					</p>
				</section>

				<section>
					<h2 className="text-lg font-semibold">Account responsibility</h2>
					<p className="text-muted-foreground mt-2">
						You are responsible for keeping your login credentials secure. If
						you suspect unauthorized access to your account, change your
						password immediately or contact us.
					</p>
				</section>

				<section>
					<h2 className="text-lg font-semibold">Acceptable use</h2>
					<p className="text-muted-foreground mt-2">
						Do not use Quartermaster to store or distribute illegal content,
						spam, or malware. Do not attempt to access other users' data or
						disrupt the service. We reserve the right to suspend accounts that
						violate these terms.
					</p>
				</section>

				<section>
					<h2 className="text-lg font-semibold">Service availability</h2>
					<p className="text-muted-foreground mt-2">
						We strive to keep Quartermaster available and reliable, but we do
						not guarantee uninterrupted access. The service may be temporarily
						unavailable for maintenance or updates.
					</p>
				</section>

				<section>
					<h2 className="text-lg font-semibold">Changes</h2>
					<p className="text-muted-foreground mt-2">
						We may update these terms as the service evolves. Continued use of
						Quartermaster after changes constitutes acceptance of the updated
						terms.
					</p>
				</section>
			</div>
		</div>
	)
}
