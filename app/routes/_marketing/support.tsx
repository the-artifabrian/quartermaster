import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { data, Link } from 'react-router'
import { Icon } from '#app/components/ui/icon.tsx'
import { pipeHeaders } from '#app/utils/headers.server.ts'
import { baseMetaTags } from '#app/utils/meta.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { type Route } from './+types/support.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => [{ route: 'support', priority: 0.3 }],
}

const pageDescription =
	'Answers to common questions about Quartermaster, from importing Recipes to exporting your data.'

const faqs = [
	{
		question: 'How do I import Recipes?',
		answer:
			'Open New Recipe > Import to paste a link or a Recipe’s text. On Pro, AI can also read pasted text and screenshots. Choose Write a Recipe to type one in yourself. To restore a Quartermaster JSON export, go to Settings > Data.',
		// The iOS app shows no copy about Pro (ADR 0001).
		nativeShellAnswer:
			'Open New Recipe > Import to paste a link. Choose Write a Recipe to type one in yourself. To restore a Quartermaster JSON export, go to Settings > Data.',
	},
	{
		question: 'What lands on Shopping when I add a Meal?',
		answer:
			'Every ingredient except optional ones and those matching your Household’s Staples, the things you usually have. An amount the app can’t work out stays on the list as written. You can add any single ingredient, Staple or not, from its row on the Recipe.',
	},
	{
		question: 'Can I share with my partner or Household?',
		answer:
			'Yes. Go to Settings > Household and send them an invite link. Everyone in the Household shares the same Recipes, Staples, Plan and Shopping.',
	},
	{
		question: 'Can I export my data?',
		answer:
			'Yes. Go to Settings > Data to export your profile and your Household’s Recipes, classifications, Staples, Menus, Plan and Shopping as JSON. The file links to Recipe images and doesn’t include them. You can import the export back in.',
	},
	{
		question: 'How does the Plan work?',
		answer:
			'The Plan shows an ordered week of Meals made from Recipes, Menu snapshots, or simple notes. When you\u2019re ready, open From Plan on Shopping: every Meal and line arrives ticked except things usually on hand, such as your Staples and salt, things already on the list from somewhere else, and days that have passed. A line the Meal already put on Shopping shows as on the list. Untick what you do not need and add the rest.',
	},
	{
		question: 'Which features use AI?',
		answer:
			'AI import and Suggest description & times send the content you choose to Anthropic. Voice input sends audio to Groq for transcription, then may send the transcript to Anthropic to pick out Shopping items. These tools are optional, and everything else works without them.',
	},
	{
		question: 'How do I delete my account?',
		answer:
			'Open Settings and tap Delete my account at the bottom. You can download a JSON export first from Settings > Data. Recipe images aren’t in the file.',
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
	const isNativeShell = useIsNativeShell()
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
										<dd className="mt-0.5">
											{isNativeShell && faq.nativeShellAnswer
												? faq.nativeShellAnswer
												: faq.answer}
										</dd>
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
