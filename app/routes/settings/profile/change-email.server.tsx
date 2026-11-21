import { invariant } from '@epic-web/invariant'
import * as E from '@react-email/components'
import { data } from 'react-router'
import {
	requireRecentVerification,
	type VerifyFunctionArgs,
} from '#app/routes/_auth/verify.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { runInBackground } from '#app/utils/background.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	checkEmailCode,
	consumeEmailCode,
	endResetCodes,
} from '#app/utils/email-code.server.ts'
import { sendEmail } from '#app/utils/email.server.ts'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { newEmailAddressSessionKey, requestedAddresses } from './change-email'

export async function handleVerification({
	request,
	submission,
}: VerifyFunctionArgs) {
	await requireRecentVerification(request)
	invariant(
		submission.status === 'success',
		'Submission should be successful by now',
	)
	// The code was checked against `target`; it may only change the email of
	// the user who is signed in.
	const userId = await requireUserId(request)
	if (submission.value.target !== userId) {
		return data(
			{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
			{ status: 400 },
		)
	}

	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const sameDevice = {
		result: submission.reply({
			formErrors: [
				'You must submit the code on the same device that requested the email change.',
			],
		}),
	}
	const addresses = requestedAddresses(
		verifySession.get(newEmailAddressSessionKey),
	)
	if (addresses.length === 0) return data(sameDevice, { status: 400 })

	const code = {
		type: 'change-email' as const,
		target: userId,
		code: submission.value.code,
		token: submission.value.token,
	}
	// The new email is the address this code was sent to, which this device
	// must have asked for.
	const match = await checkEmailCode(code)
	if (!match?.address) {
		return data(
			{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
			{ status: 400 },
		)
	}
	if (!addresses.includes(match.address)) {
		return data(sameDevice, { status: 400 })
	}

	const preUpdateUser = await prisma.user.findFirstOrThrow({
		select: { email: true },
		where: { id: userId },
	})
	// The code is used and the email changed together, or neither happens.
	// Of two submits of the same code only one changes anything.
	// Reset codes sent to the old address end with it.
	const user = await consumeEmailCode(code, async (tx, row) => {
		await endResetCodes(tx, userId)
		return tx.user.update({
			where: { id: userId },
			select: { id: true, email: true, username: true },
			data: { email: row.address! },
		})
	})
	if (!user) {
		return data(
			{ result: submission.reply({ fieldErrors: { code: ['Invalid code'] } }) },
			{ status: 400 },
		)
	}

	runInBackground(
		sendEmail({
			to: preUpdateUser.email,
			subject: 'Quartermaster email changed',
			react: <EmailChangeNoticeEmail userId={user.id} />,
		}),
		'sending an email-change notification',
	)

	return redirectWithToast(
		'/settings/profile',
		{
			title: 'Email Changed',
			type: 'success',
			description: `Your email has been changed to ${user.email}`,
		},
		{
			headers: {
				'set-cookie': await verifySessionStorage.destroySession(verifySession),
			},
		},
	)
}

export function EmailChangeEmail({
	verifyUrl,
	otp,
}: {
	verifyUrl: string
	otp: string
}) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Quartermaster Email Change</E.Text>
				</h1>
				<p>
					<E.Text>
						Here's your verification code: <strong>{otp}</strong>
					</E.Text>
				</p>
				<p>
					<E.Text>Or click the link:</E.Text>
				</p>
				<E.Link href={verifyUrl}>{verifyUrl}</E.Link>
			</E.Container>
		</E.Html>
	)
}

function EmailChangeNoticeEmail({ userId }: { userId: string }) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>Your Quartermaster email has been changed</E.Text>
				</h1>
				<p>
					<E.Text>
						We're writing to let you know that your Quartermaster email has been
						changed.
					</E.Text>
				</p>
				<p>
					<E.Text>
						If you changed your email address, then you can safely ignore this.
						But if you did not change your email address, then please contact
						support immediately.
					</E.Text>
				</p>
				<p>
					<E.Text>Your Account ID: {userId}</E.Text>
				</p>
			</E.Container>
		</E.Html>
	)
}
