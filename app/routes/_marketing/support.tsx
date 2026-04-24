import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { type Route } from './+types/support.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'support', priority: 0.3 }],
}

const pageDescription =
	'Got a question about Quartermaster? Answers to the most common ones: importing recipes, sharing with your household, meal planning, exporting your data.'

const faqs = [
	{
		question: 'How do I import recipes?',
		answer:
			'Several ways: paste a URL and Quartermaster extracts the recipe automatically, bulk-import by pasting text from Apple Notes (separate recipes with ---), or drag and drop .md/.txt files. You can also import a full data export from Settings > Data.',
	},
	{
		question: 'How does Quartermaster know what I can cook?',
		answer:
			'It compares your Pantry against recipe ingredients using smart matching that understands different names for the same thing (like cilantro and coriander), then shows recipes that need fewer things from the store.',
	},
	{
		question: 'Can I share with my partner or household?',
		answer:
			'Yes. Go to Settings > Household to invite members via a link. Everyone in the household shares the same recipe library, Pantry, meal plans, and shopping lists, with real-time sync.',
	},
	{
		question: 'Can I export my data?',
		answer:
			'Yes. Go to Settings > Data to export all your data (recipes, Pantry, meal plans, shopping lists, cooking logs) as JSON. You can also import this export back in. Your data is never locked in.',
	},
	{
		question: 'How does meal planning work?',
		answer:
			'The Planner shows a weekly calendar where you assign recipes to meal slots. Quartermaster analyzes ingredient overlap across your planned meals and suggests recipes that share ingredients. When you\u2019re ready, generate a shopping list that marks what is usually on hand.',
	},
	{
		question: 'How do I delete my account?',
		answer:
			'Go to Settings > Profile where you can manage your account. You can export all your data first from Settings > Data.',
	},
]

const faqJsonLd = JSON.stringify({
	'@context': 'https://schema.org',
	'@type': 'FAQPage',
	mainEntity: faqs.map((faq) => ({
		'@type': 'Question',
		name: faq.question,
		acceptedAnswer: {
			'@type': 'Answer',
			text: faq.answer,
		},
	})),
}).replace(/</g, '\\u003c')

export const meta: Route.MetaFunction = ({ matches }) => {
	return [
		{ title: 'Support | Quartermaster' },
		{ name: 'description', content: pageDescription },
		{ property: 'og:title', content: 'Support | Quartermaster' },
		{ property: 'og:description', content: pageDescription },
		...baseMetaTags(matches),
	]
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
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: faqJsonLd }}
			/>
			<h1 className="font-serif text-[2.25rem] leading-[1.15] tracking-[-0.02em]">
				Support
			</h1>

			<div className="mt-8 space-y-4">
				<div className="bg-muted/50 rounded-xl p-5">
					<div className="flex gap-3">
						<Icon
							name="question-mark-circled"
							className="text-primary mt-1.5 size-5 shrink-0"
						/>
						<div>
							<h2 className="font-serif text-[1.5rem] leading-[1.3] tracking-[-0.01em]">
								Common questions
							</h2>
							<dl className="text-muted-foreground mt-3 space-y-3 text-sm">
								{faqs.map((faq) => (
									<div key={faq.question}>
										<dt className="text-foreground font-medium">
											{faq.question}
										</dt>
										<dd className="mt-0.5">{faq.answer}</dd>
									</div>
								))}
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
