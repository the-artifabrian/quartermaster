import { type SubmissionResult } from '@conform-to/react'
import { parseWithZod } from '@conform-to/zod/v4'
import { toast } from 'sonner'
import { type z } from 'zod'
import { isNetworkFailure } from './network-failure.ts'

export const OFFLINE_NOT_SAVED_MESSAGE =
	'You’re offline, so nothing was saved. Your changes are still here.'

/** A Save or Delete that never reached the server. */
export type OfflineReply = {
	offline: true
	/** For the form (Conform's `lastResult`): what was typed, and why it
	 * was not saved. */
	result?: SubmissionResult
}

export function isOfflineReply(value: unknown): value is OfflineReply {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { offline?: unknown }).offline === true
	)
}

/**
 * An edit screen's client action. A Save that cannot reach the server would
 * replace the form with the offline page and lose the edits; instead the
 * form stays, with what was typed and a form error saying nothing was saved.
 * A Delete says so in a toast.
 */
export async function saveUnlessOffline(
	{
		request,
		serverAction,
	}: { request: Request; serverAction: () => Promise<unknown> },
	schema: z.ZodType,
) {
	// The server action reads the body; keep a copy for the reply.
	const copy = request.clone()
	try {
		return await serverAction()
	} catch (error) {
		if (!isNetworkFailure(error)) throw error
		const formData = await copy.formData()
		if (formData.get('intent') === 'delete') {
			toast.error('You’re offline, so nothing was deleted.')
			return { offline: true } satisfies OfflineReply
		}
		return {
			offline: true,
			result: parseWithZod(formData, { schema }).reply({
				formErrors: [OFFLINE_NOT_SAVED_MESSAGE],
			}),
		} satisfies OfflineReply
	}
}
