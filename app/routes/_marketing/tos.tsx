import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { type Route } from './+types/tos.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'tos', priority: 0.2 }],
}

const description =
	'The rules of the road for using Quartermaster. You own your recipes, we keep the lights on.'

export const meta: Route.MetaFunction = ({ matches }) => {
	return [
		{ title: 'Terms of Service | Quartermaster' },
		{ name: 'description', content: description },
		{ property: 'og:title', content: 'Terms of Service | Quartermaster' },
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

export default function TermsOfServiceRoute() {
	return (
		<div className="container max-w-2xl py-12">
			<h1 className="font-serif text-[2.25rem] leading-[1.15] tracking-[-0.02em]">
				Terms of Service
			</h1>
			<p className="text-muted-foreground mt-2 text-sm">
				Last updated: February 2026
			</p>

			<div className="mt-8 space-y-6 text-sm/6">
				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Using Quartermaster
					</h2>
					<p className="text-muted-foreground mt-2">
						Quartermaster is a personal recipe management service. By creating
						an account, you agree to use the service for its intended purpose:
						storing and organizing your recipes, keeping a Pantry, and planning
						meals.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Your content
					</h2>
					<p className="text-muted-foreground mt-2">
						You own the recipes, images, and other content you add to
						Quartermaster. We do not claim any ownership or license over your
						content beyond what is necessary to operate the service (storing,
						displaying, and backing up your data).
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Account responsibility
					</h2>
					<p className="text-muted-foreground mt-2">
						You are responsible for keeping your login credentials secure. If
						you suspect unauthorized access to your account, change your
						password immediately or contact us.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Acceptable use
					</h2>
					<p className="text-muted-foreground mt-2">
						Do not use Quartermaster to store or distribute illegal content,
						spam, or malware. Do not attempt to access other users' data or
						disrupt the service. We reserve the right to suspend accounts that
						violate these terms.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Service availability
					</h2>
					<p className="text-muted-foreground mt-2">
						We strive to keep Quartermaster available and reliable, but we do
						not guarantee uninterrupted access. The service may be temporarily
						unavailable for maintenance or updates.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Changes
					</h2>
					<p className="text-muted-foreground mt-2">
						We may update these terms as the service evolves. Continued use of
						Quartermaster after changes constitutes acceptance of the updated
						terms.
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
