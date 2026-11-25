import { clsx, type ClassValue } from 'clsx'
import { type GetSrcArgs } from 'openimg/react'
import { useFormAction, useNavigation } from 'react-router'
import { twMerge } from 'tailwind-merge'
import { snapImageSize } from './image-route.ts'

export function getImgSrc({
	height,
	optimizerEndpoint,
	src,
	width,
	fit,
	format,
}: GetSrcArgs) {
	// Our own image route keeps its query flat:
	// /resources/images?objectKey=...&h=...&w=...&fit=...&format=...
	// where openimg's default would nest it:
	// /resources/images?src=%2Fresources%2Fimages%3FobjectKey%3D...%26w%3D...%26h%3D...
	if (src.startsWith(optimizerEndpoint)) {
		const [endpoint, query] = src.split('?')
		const searchParams = new URLSearchParams(query)
		// The route serves only listed sizes, so ask for the one it would serve
		// and every page shares one URL (and one cached copy) per size.
		const size = snapImageSize({
			width: Math.round(width),
			height: Math.round(height),
		})
		if (
			import.meta.env.DEV &&
			(size.width !== Math.round(width) || size.height !== Math.round(height))
		) {
			console.warn(
				`An <Img> asked for ${Math.round(width)}x${Math.round(height)}, which the image route doesn't list. Add its size to IMG_SIZES in app/utils/image-route.ts.`,
			)
		}
		searchParams.set('h', size.height.toString())
		searchParams.set('w', size.width.toString())
		if (fit) {
			searchParams.set('fit', fit)
		}
		if (format) {
			searchParams.set('format', format)
		}
		return `${endpoint}?${searchParams.toString()}`
	}
	// Anything else, such as the form's data: preview of a picked photo, goes
	// to the <img> as it is: the image route serves stored photos only.
	return src
}

export function getErrorMessage(error: unknown) {
	if (typeof error === 'string') return error
	if (
		error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message
	}
	console.error('Unable to get error message for error', error)
	return 'Something went wrong'
}

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

/**
 * Small-caps section label — the one sanctioned grouping device for flat
 * surfaces (ingredient groups, settings groups, form sections).
 */
export const sectionLabelClass =
	'text-xs font-semibold tracking-wider uppercase text-muted-foreground'

/**
 * Combine multiple header objects into one (uses append so headers are not overridden)
 */
export function combineHeaders(
	...headers: Array<ResponseInit['headers'] | null | undefined>
) {
	const combined = new Headers()
	for (const header of headers) {
		if (!header) continue
		for (const [key, value] of new Headers(header).entries()) {
			combined.append(key, value)
		}
	}
	return combined
}

/**
 * Combine multiple response init objects into one (uses combineHeaders)
 */
export function combineResponseInits(
	...responseInits: Array<ResponseInit | null | undefined>
) {
	let combined: ResponseInit = {}
	for (const responseInit of responseInits) {
		combined = {
			...responseInit,
			headers: combineHeaders(combined.headers, responseInit?.headers),
		}
	}
	return combined
}

/**
 * Returns true if the current navigation is submitting the current route's
 * form. Defaults to the current route's form action, method POST and any
 * non-idle state.
 *
 * The default form action includes the query string and
 * `navigation.formAction` doesn't, so pass `formAction` to match a form
 * submitted without those query params.
 */
export function useIsPending({
	formAction,
	formMethod = 'POST',
	state = 'non-idle',
}: {
	formAction?: string
	formMethod?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE'
	state?: 'submitting' | 'loading' | 'non-idle'
} = {}) {
	const contextualFormAction = useFormAction()
	const navigation = useNavigation()
	const isPendingState =
		state === 'non-idle'
			? navigation.state !== 'idle'
			: navigation.state === state
	return (
		isPendingState &&
		navigation.formAction === (formAction ?? contextualFormAction) &&
		navigation.formMethod === formMethod
	)
}
