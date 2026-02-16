import { parseWithZod } from '@conform-to/zod'
import { data } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { RedeemCodeSchema } from '#app/utils/invite-code-status.ts'
import { redeemInviteCode } from '#app/utils/invite-codes.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/redeem-invite-code.ts'

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const submission = parseWithZod(formData, { schema: RedeemCodeSchema })

	if (submission.status !== 'success') {
		return data(
			{ result: submission.reply(), error: null },
			{ status: 400 },
		)
	}

	const result = await redeemInviteCode(submission.value.code, userId)

	if (!result.success) {
		return data(
			{
				result: submission.reply({ formErrors: [result.error] }),
				error: result.error,
			},
			{ status: 400 },
		)
	}

	return redirectWithToast('/recipes', {
		type: 'success',
		title: 'Welcome to Pro!',
		description: `You have Pro access until ${result.trialEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`,
	})
}
