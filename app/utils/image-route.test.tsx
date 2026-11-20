// Failure list for the sizes the pages ask the image route for:
// - an <Img> at one of the app's sizes asks, through openimg's srcset and
//   the app's breakpoints, for a size missing from the route's list, so the
//   route serves something other than what the page laid out
// - a size outside the list (a new <Img> with its own width) makes a URL
//   the route snaps, so the page and the route disagree on the cached copy
// - the form's preview of a picked file is a data: URL, which must reach
//   the <img> as is rather than becoming a request the route refuses
import { renderToStaticMarkup } from 'react-dom/server'
import { type GetSrcArgs, Img, OpenImgContextProvider } from 'openimg/react'
import { expect, test, vi } from 'vitest'
import { IMAGE_BREAKPOINTS, IMAGE_SIZES, IMG_SIZES } from './image-route.ts'
import { getImgSrc } from './misc.tsx'

const listed = new Set(
	IMAGE_SIZES.map(({ width, height }) => `${width}x${height}`),
)

test.each(Object.entries(IMG_SIZES))(
	'asks only for listed sizes from an <Img> at the %s size',
	(_, size) => {
		const asked: Array<string> = []
		renderToStaticMarkup(
			<OpenImgContextProvider
				optimizerEndpoint="/resources/images"
				breakpoints={[...IMAGE_BREAKPOINTS]}
				getSrc={(args: GetSrcArgs) => {
					asked.push(`${Math.round(args.width)}x${Math.round(args.height)}`)
					return getImgSrc(args)
				}}
			>
				<Img
					src="/resources/images?objectKey=users%2Fu%2Frecipes%2Fr%2Fimages%2Fa.png"
					alt=""
					{...size}
				/>
			</OpenImgContextProvider>,
		)
		expect(asked.length).toBeGreaterThan(0)
		expect(asked.filter((entry) => !listed.has(entry))).toEqual([])
	},
)

test('asks for the next listed size up when given a size outside the list', () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const url = getImgSrc({
		src: '/resources/images?objectKey=a',
		optimizerEndpoint: '/resources/images',
		width: 500,
		height: 375,
		format: 'webp',
	})
	const params = new URL(url, 'https://useqm.app').searchParams
	expect([params.get('w'), params.get('h')]).toEqual(['640', '480'])
	expect(warn).toHaveBeenCalledOnce()
})

test('hands a data: preview to the <img> as it is', () => {
	const src = 'data:image/png;base64,iVBORw0KGgo='
	expect(
		getImgSrc({
			src,
			optimizerEndpoint: '/resources/images',
			width: 160,
			height: 120,
		}),
	).toBe(src)
})
