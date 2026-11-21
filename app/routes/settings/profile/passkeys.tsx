import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { startRegistration } from '@simplewebauthn/browser'
import { formatDistanceToNow } from 'date-fns'
import { useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
	Form,
	Link,
	useNavigate,
	useNavigation,
	useRevalidator,
} from 'react-router'
import { z } from 'zod'
import { Field } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { ConfirmSheet } from '#app/components/ui/confirm-sheet.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import {
	getWebAuthnConfig,
	webauthnUserHandle,
} from '#app/routes/_auth/webauthn/utils.server.ts'
import { requireRecentVerification } from '#app/routes/_auth/verify.server.ts'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import {
	isPasskeyPromptDismissed,
	passkeyErrorName,
	signalAcceptedPasskeys,
	signalUnknownPasskey,
} from '#app/utils/passkeys.ts'
import { type Route } from './+types/passkeys.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Passkeys',
	getSitemapEntries: () => null,
}

export async function loader({ request }: Route.LoaderArgs) {
	// Adding a passkey needs a recent 2FA check; ask before the password.
	await requireRecentVerification(request)
	const userId = await requireUserId(request)
	const [passkeys, password] = await Promise.all([
		prisma.passkey.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
			select: {
				id: true,
				deviceType: true,
				createdAt: true,
			},
		}),
		prisma.password.findUnique({
			where: { userId },
			select: { userId: true },
		}),
	])
	return {
		passkeys,
		hasPassword: Boolean(password),
		rpId: getWebAuthnConfig().rpID,
		userHandle: webauthnUserHandle(userId),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const userId = await requireUserId(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	if (intent === 'delete') {
		const passkeyId = formData.get('passkeyId')
		if (typeof passkeyId !== 'string') {
			return Response.json(
				{ status: 'error', error: 'Invalid passkey ID' },
				{ status: 400 },
			)
		}

		await prisma.passkey.delete({
			where: {
				id: passkeyId,
				userId, // Ensure the passkey belongs to the user
			},
		})
		return Response.json({ status: 'success' })
	}

	return Response.json(
		{ status: 'error', error: 'Invalid intent' },
		{ status: 400 },
	)
}

const RegistrationOptionsSchema = z.object({
	options: z.object({
		rp: z.object({
			id: z.string(),
			name: z.string(),
		}),
		user: z.object({
			id: z.string(),
			name: z.string(),
			displayName: z.string(),
		}),
		challenge: z.string(),
		pubKeyCredParams: z.array(
			z.object({
				type: z.literal('public-key'),
				alg: z.number(),
			}),
		),
		authenticatorSelection: z
			.object({
				authenticatorAttachment: z
					.enum(['platform', 'cross-platform'])
					.optional(),
				residentKey: z
					.enum(['required', 'preferred', 'discouraged'])
					.optional(),
				userVerification: z
					.enum(['required', 'preferred', 'discouraged'])
					.optional(),
				requireResidentKey: z.boolean().optional(),
			})
			.optional(),
		excludeCredentials: z
			.array(
				z.object({
					id: z.string(),
					type: z.literal('public-key'),
					transports: z
						.array(
							z.enum([
								'ble',
								'cable',
								'hybrid',
								'internal',
								'nfc',
								'smart-card',
								'usb',
							]),
						)
						.optional(),
				}),
			)
			.optional(),
		timeout: z.number().optional(),
		attestation: z
			.enum(['none', 'indirect', 'direct', 'enterprise'])
			.optional(),
	}),
}) satisfies z.ZodType<{ options: PublicKeyCredentialCreationOptionsJSON }>

const StartResponseSchema = z.discriminatedUnion('status', [
	RegistrationOptionsSchema.extend({ status: z.literal('ready') }),
	z.object({ status: z.literal('reverify'), location: z.string() }),
	z.object({
		status: z.literal('error'),
		error: z.string(),
		field: z.literal('password').optional(),
	}),
])

const FinishResponseSchema = z.discriminatedUnion('status', [
	z.object({ status: z.literal('success') }),
	z.object({ status: z.literal('error'), error: z.string() }),
])

function postRegistration(body: unknown) {
	return fetch('/webauthn/registration', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

export default function Passkeys({ loaderData }: Route.ComponentProps) {
	const revalidator = useRevalidator()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const [passwordError, setPasswordError] = useState<string | null>(null)
	// Kept in state so a cancelled prompt leaves it filled in; React resets
	// the uncontrolled fields of a form after its action.
	const [password, setPassword] = useState('')
	const { rpId, userHandle } = loaderData
	const acceptedIds = loaderData.passkeys.map((passkey) => passkey.id).join(' ')

	// Tell the browser which passkeys the account still has, on load and after
	// a delete, so a deleted one stops showing up in the phone's picker.
	useEffect(() => {
		void signalAcceptedPasskeys({
			rpId,
			userId: userHandle,
			credentialIds: acceptedIds ? acceptedIds.split(' ') : [],
		})
	}, [rpId, userHandle, acceptedIds])

	async function addPasskey() {
		setError(null)
		setPasswordError(null)
		const couldNotAdd = 'Couldn’t create the passkey. Try again.'

		let started: z.infer<typeof StartResponseSchema>
		try {
			const response = await postRegistration({
				intent: 'options',
				password,
			})
			started = StartResponseSchema.parse(await response.json())
		} catch {
			setError(couldNotAdd)
			return
		}
		if (started.status === 'reverify') {
			await navigate(started.location)
			return
		}
		if (started.status === 'error') {
			if (started.field === 'password') setPasswordError(started.error)
			else setError(started.error)
			return
		}

		let registration: Awaited<ReturnType<typeof startRegistration>>
		try {
			registration = await startRegistration({ optionsJSON: started.options })
		} catch (err) {
			if (isPasskeyPromptDismissed(err)) return
			setError(
				passkeyErrorName(err) === 'InvalidStateError'
					? 'This device already has a passkey for your account.'
					: couldNotAdd,
			)
			return
		}

		const finished = await postRegistration({
			intent: 'verify',
			response: registration,
		})
			.then(async (response) =>
				FinishResponseSchema.parse(await response.json()),
			)
			.catch(() => null)
		if (finished?.status !== 'success') {
			setError(couldNotAdd)
			// The device made a passkey the server didn't keep.
			void signalUnknownPasskey({
				rpId: started.options.rp.id,
				credentialId: registration.id,
			})
			return
		}
		setPassword('')
		void revalidator.revalidate()
	}

	return (
		<div className="flex flex-col gap-6">
			{loaderData.hasPassword ? (
				<form action={addPasskey}>
					<Field
						labelProps={{ children: 'Current password' }}
						inputProps={{
							name: 'password',
							type: 'password',
							autoComplete: 'current-password',
							required: true,
							value: password,
							onChange: (event) => setPassword(event.currentTarget.value),
						}}
						errors={passwordError ? [passwordError] : undefined}
					/>
					<div className="flex justify-end">
						<AddPasskeyButton />
					</div>
				</form>
			) : (
				<p className="text-muted-foreground">
					Adding a passkey asks for your password.{' '}
					<Link
						to="/settings/profile/password/create"
						className="text-foreground underline"
					>
						Create a password
					</Link>{' '}
					first.
				</p>
			)}

			{error ? (
				<div
					role="alert"
					className="bg-destructive/15 text-destructive rounded-lg p-4"
				>
					{error}
				</div>
			) : null}

			{loaderData.passkeys.length ? (
				<ul className="flex flex-col gap-4" title="passkeys">
					{loaderData.passkeys.map((passkey) => (
						<li
							key={passkey.id}
							className="bg-muted/40 flex items-center justify-between gap-4 rounded-lg p-4"
						>
							<div className="flex flex-col gap-2">
								<div className="flex items-center gap-2">
									<Icon name="lock-closed" />
									<span className="font-semibold">
										{passkey.deviceType === 'platform'
											? 'Device'
											: 'Security Key'}
									</span>
								</div>
								<div className="text-muted-foreground text-sm">
									Registered {formatDistanceToNow(new Date(passkey.createdAt))}{' '}
									ago
								</div>
							</div>
							<DeletePasskeyForm passkeyId={passkey.id} />
						</li>
					))}
				</ul>
			) : (
				<div className="text-muted-foreground text-center">
					No passkeys registered yet
				</div>
			)}
		</div>
	)
}

function AddPasskeyButton() {
	const { pending } = useFormStatus()
	return (
		<StatusButton
			type="submit"
			variant="secondary"
			status={pending ? 'pending' : 'idle'}
			disabled={pending}
			className="flex items-center gap-2"
		>
			<Icon name="plus">Register new passkey</Icon>
		</StatusButton>
	)
}

function DeletePasskeyForm({ passkeyId }: { passkeyId: string }) {
	const [confirming, setConfirming] = useState(false)
	const navigation = useNavigation()
	const formId = `delete-passkey-${passkeyId}`
	const pending =
		navigation.state !== 'idle' &&
		navigation.formData?.get('passkeyId') === passkeyId
	// The deleted passkey's row goes, sheet and all. One that stays (the
	// delete failed) puts its sheet away.
	useEffect(() => {
		if (navigation.state === 'idle') setConfirming(false)
	}, [navigation.state])

	return (
		<Form method="POST" id={formId}>
			<input type="hidden" name="passkeyId" value={passkeyId} />
			<Button
				type="button"
				onClick={() => setConfirming(true)}
				variant="destructive"
				size="sm"
				className="flex items-center gap-2"
			>
				<Icon name="trash">Delete</Icon>
			</Button>
			<ConfirmSheet
				open={confirming}
				onCancel={() => setConfirming(false)}
				title="Delete this passkey?"
				description="You won’t be able to log in with it again."
				confirmLabel="Delete passkey"
				formId={formId}
				name="intent"
				value="delete"
				pending={pending}
			/>
		</Form>
	)
}
