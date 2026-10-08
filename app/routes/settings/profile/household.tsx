import { getFormProps, getInputProps, useForm } from '@conform-to/react'
import { getZodConstraint, parseWithZod } from '@conform-to/zod/v4'
import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import { data, useFetcher } from 'react-router'
import { z } from 'zod'
import { ErrorList, Field } from '#app/components/forms.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { emitHouseholdEvent } from '#app/utils/household-events.server.ts'
import {
	requireUserWithHousehold,
	createHouseholdInvite,
	revokeInvite,
	removeMember,
	leaveHousehold,
} from '#app/utils/household.server.ts'
import { useDoubleCheck } from '#app/utils/misc.tsx'
import { redirectWithToast } from '#app/utils/toast.server.ts'
import { type Route } from './+types/household.ts'
import { type SettingsPageHandle } from './_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Household',
	getSitemapEntries: () => null,
}

const RenameSchema = z.object({
	name: z.string().min(1, 'Name is required').max(100),
})

export async function loader({ request }: Route.LoaderArgs) {
	const { userId, householdId, role } = await requireUserWithHousehold(request)

	const household = await prisma.household.findUniqueOrThrow({
		where: { id: householdId },
		select: {
			id: true,
			name: true,
			members: {
				select: {
					id: true,
					role: true,
					user: {
						select: { id: true, username: true, name: true },
					},
				},
			},
			invites: {
				where: {
					usedAt: null,
					expiresAt: { gt: new Date() },
				},
				select: {
					id: true,
					token: true,
					expiresAt: true,
					createdAt: true,
				},
				orderBy: { createdAt: 'desc' },
			},
		},
	})

	return {
		household,
		currentUserId: userId,
		currentRole: role,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { userId, householdId, role } = await requireUserWithHousehold(request)
	const formData = await request.formData()
	const intent = formData.get('intent')

	switch (intent) {
		case 'rename-household': {
			if (role !== 'owner') {
				throw new Response('Only the owner can rename the household', {
					status: 403,
				})
			}
			const submission = parseWithZod(formData, { schema: RenameSchema })
			if (submission.status !== 'success') {
				return data(
					{ result: submission.reply(), inviteToken: null },
					{ status: 400 },
				)
			}
			await prisma.household.update({
				where: { id: householdId },
				data: { name: submission.value.name },
			})
			return { result: submission.reply(), inviteToken: null }
		}
		case 'create-invite': {
			if (role !== 'owner') {
				throw new Response('Only the owner can create invites', {
					status: 403,
				})
			}
			const invite = await createHouseholdInvite(householdId, userId)
			return { result: null, inviteToken: invite.token }
		}
		case 'revoke-invite': {
			const inviteId = formData.get('inviteId')
			if (typeof inviteId !== 'string') {
				throw new Response('Invalid inviteId', { status: 400 })
			}
			await revokeInvite(inviteId, userId, householdId)
			return { result: null, inviteToken: null }
		}
		case 'remove-member': {
			const targetUserId = formData.get('targetUserId')
			if (typeof targetUserId !== 'string') {
				throw new Response('Invalid targetUserId', { status: 400 })
			}
			// Remove first, so a request naming someone outside this household
			// fails before it can announce a departure.
			await removeMember(userId, targetUserId, householdId)
			void emitHouseholdEvent({
				type: 'household_member_left',
				payload: {},
				userId: targetUserId,
				householdId,
			})
			return { result: null, inviteToken: null }
		}
		case 'leave-household': {
			if (role === 'owner') {
				throw new Response('The owner cannot leave the household', {
					status: 403,
				})
			}
			// Announce only a departure that happened.
			await leaveHousehold(userId)
			await emitHouseholdEvent({
				type: 'household_member_left',
				payload: {},
				userId,
				householdId,
			})
			return redirectWithToast('/settings/profile/household', {
				type: 'success',
				description: 'You have left the household',
				title: 'Left household',
			})
		}
		default: {
			throw new Response(`Invalid intent "${intent}"`, { status: 400 })
		}
	}
}

export default function HouseholdSettings({
	loaderData,
}: Route.ComponentProps) {
	const { household, currentUserId, currentRole } = loaderData
	const isOwner = currentRole === 'owner'

	return (
		<div className="grid gap-8">
			{isOwner ? (
				<RenameHouseholdForm name={household.name} />
			) : (
				<div>
					<p className="text-muted-foreground text-sm">Household name</p>
					<p className="text-lg font-medium">{household.name}</p>
				</div>
			)}

			<div className="border-foreground my-2 h-1 border-b-[1.5px]" />

			<div>
				<h3 className="mb-4 text-base font-medium">Members</h3>
				<ul className="flex flex-col gap-3">
					{household.members.map((member) => (
						<MemberRow
							key={member.id}
							member={member}
							isOwner={isOwner}
							isCurrentUser={member.user.id === currentUserId}
						/>
					))}
				</ul>
			</div>

			{isOwner ? (
				<>
					<div className="border-foreground my-2 h-1 border-b-[1.5px]" />
					<InviteSection invites={household.invites} />
				</>
			) : null}

			{!isOwner ? (
				<>
					<div className="border-foreground my-2 h-1 border-b-[1.5px]" />
					<LeaveHousehold />
				</>
			) : null}
		</div>
	)
}

function RenameHouseholdForm({ name }: { name: string }) {
	const fetcher = useFetcher<typeof action>()

	const [form, fields] = useForm({
		id: 'rename-household',
		constraint: getZodConstraint(RenameSchema),
		lastResult: fetcher.data?.result,
		onValidate({ formData }) {
			return parseWithZod(formData, { schema: RenameSchema })
		},
		defaultValue: { name },
	})

	return (
		<fetcher.Form method="POST" {...getFormProps(form)}>
			<Field
				labelProps={{ htmlFor: fields.name.id, children: 'Household name' }}
				inputProps={getInputProps(fields.name, { type: 'text' })}
				errors={fields.name.errors}
			/>
			<ErrorList errors={form.errors} id={form.errorId} />
			<div className="mt-8">
				<StatusButton
					type="submit"
					name="intent"
					value="rename-household"
					status={
						fetcher.state !== 'idle' ? 'pending' : (form.status ?? 'idle')
					}
				>
					Rename
				</StatusButton>
			</div>
		</fetcher.Form>
	)
}

function MemberRow({
	member,
	isOwner,
	isCurrentUser,
}: {
	member: {
		id: string
		role: string
		user: { id: string; username: string; name: string | null }
	}
	isOwner: boolean
	isCurrentUser: boolean
}) {
	const dc = useDoubleCheck()
	const fetcher = useFetcher<typeof action>()

	return (
		<li className="bg-muted/40 flex items-center justify-between rounded-lg p-3">
			<div>
				<p className="font-medium">
					{member.user.name ?? member.user.username}
					{isCurrentUser ? ' (you)' : ''}
				</p>
				<p className="text-muted-foreground text-sm">
					@{member.user.username} · {member.role}
				</p>
			</div>
			{isOwner && !isCurrentUser ? (
				<fetcher.Form method="POST">
					<input type="hidden" name="targetUserId" value={member.user.id} />
					<StatusButton
						{...dc.getButtonProps({
							type: 'submit',
							name: 'intent',
							value: 'remove-member',
						})}
						variant={dc.doubleCheck ? 'destructive' : 'default'}
						size="sm"
						status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
					>
						{dc.doubleCheck ? 'Are you sure?' : 'Remove'}
					</StatusButton>
				</fetcher.Form>
			) : null}
		</li>
	)
}

function InviteSection({
	invites,
}: {
	invites: Array<{
		id: string
		token: string
		expiresAt: Date
		createdAt: Date
	}>
}) {
	const createFetcher = useFetcher<typeof action>()
	const newToken = createFetcher.data?.inviteToken

	return (
		<div>
			<h3 className="mb-4 text-base font-medium">Invites</h3>

			<createFetcher.Form method="POST">
				<Button type="submit" name="intent" value="create-invite">
					<Icon name="plus" className="mr-1" />
					Generate invite link
				</Button>
			</createFetcher.Form>

			{newToken ? (
				<div className="bg-primary/10 mt-4 rounded-md p-4">
					<p className="mb-2 text-sm font-medium">
						Invite link created! Share this link:
					</p>
					<CopyLinkButton token={newToken} />
				</div>
			) : null}

			{invites.length > 0 ? (
				<div className="mt-4 flex flex-col gap-2">
					<p className="text-muted-foreground text-sm">Pending invites:</p>
					{invites.map((invite) => (
						<InviteRow key={invite.id} invite={invite} />
					))}
				</div>
			) : null}
		</div>
	)
}

/**
 * Copies an invite link. The button reads "Copied" for two seconds; when the
 * browser refuses the copy, `failedUrl` holds the link to show for copying
 * by hand.
 */
function useCopyInviteLink(token: string) {
	const [copied, setCopied] = useState(false)
	const [failedUrl, setFailedUrl] = useState<string | null>(null)
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	useEffect(() => () => clearTimeout(timer.current), [])

	async function copy() {
		const url = `${window.location.origin}/household/join?token=${token}`
		clearTimeout(timer.current)
		try {
			await navigator.clipboard.writeText(url)
			setFailedUrl(null)
			setCopied(true)
			timer.current = setTimeout(() => setCopied(false), 2000)
		} catch {
			setCopied(false)
			setFailedUrl(url)
		}
	}

	return { copied, failedUrl, copy }
}

/** The invite link, selected, for copying by hand. */
function ManualCopyField({ url }: { url: string }) {
	const input = useRef<HTMLInputElement>(null)
	// Select once when shown; a re-render of the page must not take focus back.
	useEffect(() => {
		input.current?.focus()
		input.current?.select()
	}, [])
	return (
		<input
			ref={input}
			type="text"
			readOnly
			value={url}
			aria-label="Invite link"
			className="bg-background w-full min-w-0 rounded border px-2 py-1 text-sm"
			onFocus={(event) => event.currentTarget.select()}
		/>
	)
}

function CopyLinkButton({ token }: { token: string }) {
	const path = `/household/join?token=${token}`
	const { copied, failedUrl, copy } = useCopyInviteLink(token)

	return (
		<div className="flex flex-col gap-2">
			<div className="flex min-w-0 items-center gap-2">
				<code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-sm">
					{path}
				</code>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void copy()}
				>
					{copied ? 'Copied' : 'Copy'}
				</Button>
			</div>
			{failedUrl ? <ManualCopyField url={failedUrl} /> : null}
		</div>
	)
}

function InviteRow({
	invite,
}: {
	invite: { id: string; token: string; expiresAt: Date; createdAt: Date }
}) {
	const fetcher = useFetcher<typeof action>()
	const { copied, failedUrl, copy } = useCopyInviteLink(invite.token)

	return (
		<div className="bg-muted/40 flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:flex-wrap sm:items-center">
			<div className="min-w-0 flex-1">
				<code className="text-xs">{invite.token.slice(0, 8)}...</code>
				<p className="text-muted-foreground text-xs">
					Expires {new Date(invite.expiresAt).toLocaleDateString()}
				</p>
			</div>
			<div className="flex shrink-0 gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void copy()}
				>
					{copied ? 'Copied' : 'Copy link'}
				</Button>
				<fetcher.Form method="POST">
					<input type="hidden" name="inviteId" value={invite.id} />
					<Button
						type="submit"
						name="intent"
						value="revoke-invite"
						variant="destructive"
						size="sm"
					>
						Revoke
					</Button>
				</fetcher.Form>
			</div>
			{failedUrl ? (
				<div className="sm:basis-full">
					<ManualCopyField url={failedUrl} />
				</div>
			) : null}
		</div>
	)
}

function LeaveHousehold() {
	const dc = useDoubleCheck()
	const fetcher = useFetcher<typeof action>()

	return (
		<div>
			<h3 className="mb-4 text-base font-medium">Leave Household</h3>
			<p className="text-muted-foreground mb-4 text-sm">
				Leaving will create a new solo household for you. Your recipes will be
				copied, but shared Staples and meal plans will stay with the current
				household.
			</p>
			<fetcher.Form method="POST">
				<StatusButton
					{...dc.getButtonProps({
						type: 'submit',
						name: 'intent',
						value: 'leave-household',
					})}
					variant={dc.doubleCheck ? 'destructive' : 'default'}
					status={fetcher.state !== 'idle' ? 'pending' : 'idle'}
				>
					<Icon name="exit">
						{dc.doubleCheck ? 'Are you sure?' : 'Leave household'}
					</Icon>
				</StatusButton>
			</fetcher.Form>
		</div>
	)
}
