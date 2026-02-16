/**
 * Shared meta tag helpers for marketing pages.
 *
 * In React Router v7, child route `meta` completely replaces parent `meta`,
 * so marketing pages must re-include the base OG/Twitter tags from root.
 */

type MetaDescriptor =
	| { title: string }
	| { name: string; content: string }
	| { property: string; content: string }

/**
 * Returns standard OG and Twitter meta tags that would otherwise be lost
 * when a child route's meta function replaces the root meta.
 */
export function baseMetaTags(
	matches: Array<{ id: string; data?: unknown } | undefined>,
): MetaDescriptor[] {
	const rootMatch = matches.find((m) => m?.id === 'root')
	const origin = (
		rootMatch?.data as { requestInfo?: { origin?: string } } | undefined
	)?.requestInfo?.origin

	return [
		{ property: 'og:site_name', content: 'Quartermaster' },
		{ property: 'og:type', content: 'website' },
		{ property: 'og:locale', content: 'en_US' },
		{ name: 'twitter:card', content: 'summary_large_image' },
		...(origin
			? [
					{
						property: 'og:image',
						content: `${origin}/og-image.png`,
					},
					{ property: 'og:image:width', content: '1200' },
					{ property: 'og:image:height', content: '630' },
				]
			: []),
	]
}
