import * as E from '@react-email/components'

export function PasskeyAddedEmail({ username }: { username: string }) {
	return (
		<E.Html lang="en" dir="ltr">
			<E.Container>
				<h1>
					<E.Text>A passkey was added to your account</E.Text>
				</h1>
				<p>
					<E.Text>
						A new passkey was just added to the Quartermaster account {username}
						. It can be used to log in.
					</E.Text>
				</p>
				<p>
					<E.Text>If you added it, there’s nothing to do.</E.Text>
				</p>
				<p>
					<E.Text>
						If you didn’t, change your password in Settings. That logs out every
						other device. Then delete the passkey you don’t recognise in
						Settings, under Passkeys.
					</E.Text>
				</p>
			</E.Container>
		</E.Html>
	)
}
