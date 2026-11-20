/**
 * What the public image route (/resources/images) accepts: the stored photo
 * keys the app writes, and the sizes its pages ask for. The route has no
 * login in front of it, so anything else it would fetch, resize and cache
 * on disk is refused or snapped to a listed size.
 */

/** The width and height of every <Img> that shows a stored photo. */
export const IMG_SIZES = {
	thumbnail: { width: 72, height: 72 },
	formPreview: { width: 160, height: 120 },
	card: { width: 400, height: 300 },
	hero: { width: 800, height: 600 },
} as const

/** The picture link previews show for a shared Recipe (og:image, JSON-LD). */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const

export function getShareImageUrl(origin: string, objectKey: string) {
	return `${origin}/resources/images?objectKey=${encodeURIComponent(objectKey)}&w=${SHARE_IMAGE_SIZE.width}&h=${SHARE_IMAGE_SIZE.height}&fit=cover`
}

/**
 * Passed to OpenImgContextProvider. An <Img> adds a srcset entry for each
 * breakpoint narrower than itself, so these are listed below too.
 */
export const IMAGE_BREAKPOINTS = [640, 768] as const

type Size = { width: number; height: number }

function srcsetSizes({ width, height }: Size): Array<Size> {
	// openimg keeps breakpoints up to the <Img> width, adds the width itself,
	// and derives each height from the aspect ratio (getImgSrc rounds it).
	const widths = new Set([
		...IMAGE_BREAKPOINTS.filter((w) => w <= width),
		width,
	])
	return [...widths].map((w) => ({
		width: w,
		height: Math.round((w * height) / width),
	}))
}

/** Every size the route serves, narrowest first. */
export const IMAGE_SIZES: ReadonlyArray<Size> = [
	...Object.values(IMG_SIZES).flatMap(srcsetSizes),
	SHARE_IMAGE_SIZE,
]
	.filter(
		(size, index, all) =>
			all.findIndex(
				(other) => other.width === size.width && other.height === size.height,
			) === index,
	)
	.sort((a, b) => a.width - b.width)

/**
 * The listed size to serve for a request: the narrowest at least as wide as
 * asked (or as tall, when only a height is given), else the largest. Old
 * pages cached by the browser, the service worker or a link preview may
 * carry sizes that are no longer listed, and a slightly different size
 * shows a picture where a refusal would show a broken one.
 */
export function snapImageSize({
	width,
	height,
}: {
	width?: number
	height?: number
}): Size {
	const exact = IMAGE_SIZES.find(
		(size) => size.width === width && size.height === height,
	)
	if (exact) return exact
	const by = width === undefined ? 'height' : 'width'
	const wanted = width ?? height ?? 0
	const sorted = [...IMAGE_SIZES].sort((a, b) => a[by] - b[by])
	return sorted.find((size) => size[by] >= wanted) ?? sorted.at(-1)!
}

/**
 * The shape both storage writers produce:
 * `users/<userId>/recipes/<recipeId>/images/<file>`. Ids take no dots, and
 * the file name starts with a letter or digit, so no segment can be `.` or
 * `..`. The file name stays short enough for openimg to name its cached
 * resizes after it.
 */
const RECIPE_IMAGE_KEY =
	/^users\/[A-Za-z0-9_-]{1,64}\/recipes\/[A-Za-z0-9_-]{1,64}\/images\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function isRecipeImageKey(key: string) {
	return RECIPE_IMAGE_KEY.test(key)
}
