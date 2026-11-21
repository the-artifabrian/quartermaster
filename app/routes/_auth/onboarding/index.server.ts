import { invariant } from '@epic-web/invariant'
import { redirect } from 'react-router'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { type VerifyFunctionArgs } from '../verify.server.ts'
import { setOnboardingEmail } from './onboarding-email.server.ts'

export async function handleVerification({ submission }: VerifyFunctionArgs) {
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	const verifySession = await verifySessionStorage.getSession()
	setOnboardingEmail(verifySession, submission.value.target)
	const redirectTo = submission.value.redirectTo
	const query = redirectTo ? `?${new URLSearchParams({ redirectTo })}` : ''
	return redirect(`/onboarding${query}`, {
		headers: {
			'set-cookie': await verifySessionStorage.commitSession(verifySession),
		},
	})
}
