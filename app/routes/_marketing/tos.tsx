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
	'The terms for using Quartermaster. You own the Recipes you add.'

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
				Last updated: November 25, 2026
			</p>

			<div className="mt-8 space-y-6 text-sm/6">
				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Using Quartermaster
					</h2>
					<p className="text-muted-foreground mt-2">
						Quartermaster is an app for a household&apos;s Recipes, Plan and
						Shopping. By creating an account, you agree to use it for that.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Optional AI and voice tools
					</h2>
					<p className="text-muted-foreground mt-2">
						AI import and Suggest description &amp; times use Anthropic. Voice
						transcription uses Groq, and its transcript may be parsed by
						Anthropic. You choose when to use these tools and remain responsible
						for reviewing their output before saving or acting on it. Only
						submit content you have the right to use.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Your content
					</h2>
					<p className="text-muted-foreground mt-2">
						You own the Recipes, images and anything else you add to
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
						you think someone else has got into your account, change your
						password straight away.
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
						We try to keep Quartermaster running, but we can&apos;t promise it
						will always be available. The service may be temporarily unavailable
						for maintenance or updates.
					</p>
				</section>

				<section>
					<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
						Changes
					</h2>
					<p className="text-muted-foreground mt-2">
						We may update these terms as the app changes. If you keep using
						Quartermaster after a change, you accept the new terms.
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
