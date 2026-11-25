// The shared link preview tags. Slack, LinkedIn and iMessage ignore a relative
// og:image. Root and the marketing pages spread these tags after their own
// title and description, so the helper must not list any tag twice itself.
// tests/e2e/link-preview.test.ts checks that the image URL carries the build's
// fingerprint.
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

test('points og:image at an absolute URL on the origin from root', () => {
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

test('lists each of its own tags once', () => {
	const tags = baseMetaTags(rootWith({ requestInfo: { origin } }))
	const keys = tags.map((tag) =>
		'property' in tag ? tag.property : 'name' in tag ? tag.name : 'title',
	)
	expect(new Set(keys).size).toBe(keys.length)
})

test('points og:image at the built image, never /og-image.png in public', () => {
	const tags = baseMetaTags(rootWith({ requestInfo: { origin } }))
	const image = content(tags, 'og:image')
	expect(image && 'content' in image && image.content).toContain('og-image')
	expect(image).not.toMatchObject({ content: `${origin}/og-image.png` })
})
