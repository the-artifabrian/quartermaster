// Failure list for the shared link preview tags:
// - With the root loader's origin, og:image must be an absolute URL (Slack,
//   LinkedIn and iMessage ignore a relative one) with its width and height.
// - Without an origin (root's loader threw, so root renders its error page),
//   the image tags must be left out, not written as a relative URL.
// - Root and the marketing pages both spread these tags after their own
//   title and description, so no tag may appear twice.
// - The image URL must be the build's fingerprinted file, so a new image gets
//   a new URL and link previews stop showing the old one.
import { expect, test } from 'vitest'
import { baseMetaTags } from './meta.ts'

const origin = 'https://useqm.app'
const rootWith = (loaderData: unknown) => [{ id: 'root', loaderData }]

function content(tags: ReturnType<typeof baseMetaTags>, key: string) {
	return tags.find((tag) =>
		'property' in tag
			? tag.property === key
			: 'name' in tag && tag.name === key,
	)
}

test('points og:image at an absolute URL on the request origin', () => {
	const tags = baseMetaTags(rootWith({ requestInfo: { origin } }))
	const image = content(tags, 'og:image')
	expect(image && 'content' in image && image.content).toMatch(
		new RegExp(`^${origin}/.+\\.png$`),
	)
	expect(content(tags, 'og:image:width')).toMatchObject({ content: '1200' })
	expect(content(tags, 'og:image:height')).toMatchObject({ content: '630' })
})

test('leaves the image tags out when there is no origin', () => {
	for (const matches of [rootWith(undefined), rootWith({}), []]) {
		const tags = baseMetaTags(matches)
		expect(content(tags, 'og:image')).toBeUndefined()
		expect(content(tags, 'og:image:width')).toBeUndefined()
		expect(content(tags, 'og:image:height')).toBeUndefined()
		expect(content(tags, 'og:site_name')).toMatchObject({
			content: 'Quartermaster',
		})
	}
})

test('writes each tag once', () => {
	const tags = baseMetaTags(rootWith({ requestInfo: { origin } }))
	const keys = tags.map((tag) =>
		'property' in tag ? tag.property : 'name' in tag ? tag.name : 'title',
	)
	expect(new Set(keys).size).toBe(keys.length)
})
