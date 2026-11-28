import { type Locator, type Page } from '@playwright/test'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import { SHELL_UA } from '#tests/native-shell.ts'
import {
	createUser,
	expect,
	hydrated,
	test,
	waitFor,
} from '#tests/playwright-utils.ts'

// A 390px layout beside the test browser's 15px scrollbar.
test.use({ viewport: { width: 405, height: 844 }, hasTouch: true })

/** Every font size of text and fields inside the page's main area. */
async function sizesInMain(page: Page) {
	return page.evaluate(() => {
		const found = new Set<string>()
		const main = document.querySelector('#main-content')!
		const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const el = node.parentElement
			if (!el || !node.textContent?.trim()) continue
			const box = el.getBoundingClientRect()
			if (!box.width || !box.height) continue
			found.add(getComputedStyle(el).fontSize)
		}
		return [...found].sort()
	})
}

const box = async (locator: Locator) => (await locator.boundingBox())!
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready)
const phone = (page: Page) => page.setViewportSize({ width: 405, height: 844 })
const wider = (page: Page) => page.setViewportSize({ width: 768, height: 844 })

function extractUrl(text: string) {
	return text.match(/https?:\/\/[^\s$.?#].[^\s]*/)?.[0]
}

test('Log in reads in its phone sizes up to 767px and in the wider sizes from 768px', async ({
	page,
}) => {
	await page.goto('/login')
	const main = page.locator('#main-content')
	const title = page.getByRole('heading', { level: 1 })
	const lead = page.getByText('Use your password or a passkey.')
	const username = page.getByLabel('Username')
	const password = page.getByLabel('Password')
	const remember = page.getByText('Remember me', { exact: true })
	const forgot = page.getByRole('link', { name: 'Forgot password?' })
	const logIn = page.getByRole('button', { name: 'Log in', exact: true })
	const passkey = page.getByRole('button', { name: 'Log in with a passkey' })
	const create = main.getByRole('link', { name: 'Create an account' })
	const demo = page.getByRole('button', { name: 'Try the demo' })
	await hydrated(logIn)
	await fontsReady(page)

	await expect(title).toHaveCSS('font-size', '28px')
	await expect(title).toHaveCSS('text-align', 'left')
	await expect(lead).toHaveCSS('font-size', '16px')
	// The title, the fields and the buttons share the page's 16px gutter.
	const mainBox = await box(main)
	const fieldBox = await box(username)
	const titleBox = await box(title)
	const headerBox = await box(page.getByRole('banner'))
	expect(titleBox.x - mainBox.x).toBe(16)
	// 32px above the title and 8px under it.
	expect(titleBox.y - (headerBox.y + headerBox.height)).toBe(32)
	expect((await box(lead)).y - (titleBox.y + titleBox.height)).toBeCloseTo(8, 0)
	expect(fieldBox.x - mainBox.x).toBe(16)
	expect(fieldBox.width).toBe(mainBox.width - 32)
	// From the paragraph to the first field's label.
	const leadBox = await box(lead)
	const labelBox = await box(page.getByText('Username', { exact: true }))
	expect(labelBox.y - (leadBox.y + leadBox.height)).toBe(24)

	const logInBox = await box(logIn)
	expect(logInBox.height).toBe(48)
	expect(logInBox.width).toBe(fieldBox.width)
	await expect(logIn).toHaveCSS('font-size', '16px')
	expect((await box(passkey)).height).toBe(48)
	expect((await box(demo)).height).toBe(48)

	// Forgot password? has a 44px tap area, level with Remember me, clear of
	// it, of the field above and of the button below.
	await expect(forgot).toHaveCSS('font-size', '16px')
	const forgotBox = await box(forgot)
	const rememberBox = await box(remember)
	const passwordBox = await box(password)
	expect(forgotBox.height).toBe(44)
	expect(forgotBox.y + forgotBox.height / 2).toBe(
		rememberBox.y + rememberBox.height / 2,
	)
	expect(forgotBox.x).toBeGreaterThan(rememberBox.x + rememberBox.width)
	expect(forgotBox.y).toBeGreaterThanOrEqual(passwordBox.y + passwordBox.height)
	expect(forgotBox.y + forgotBox.height).toBeLessThanOrEqual(logInBox.y)
	// The button sits 32px under the row.
	expect(logInBox.y - (rememberBox.y + rememberBox.height)).toBe(32)

	// Create an account: 44px, between the two buttons without touching them.
	await expect(create).toHaveCSS('font-size', '16px')
	const createBox = await box(create)
	const passkeyBox = await box(passkey)
	expect(createBox.height).toBe(44)
	expect(createBox.y).toBeGreaterThanOrEqual(passkeyBox.y + passkeyBox.height)
	expect(createBox.y + createBox.height).toBeLessThanOrEqual(
		(await box(demo)).y,
	)
	// Its line is 32px under the passkey button and 16px over the demo's.
	expect(createBox.y + 10 - (passkeyBox.y + passkeyBox.height)).toBe(32)
	expect((await box(demo)).y - (createBox.y + 34)).toBe(16)

	expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '28px'])

	// At 320px the row still holds Remember me and the link side by side.
	await page.setViewportSize({ width: 335, height: 844 })
	const narrowForgot = await box(forgot)
	const narrowRemember = await box(remember)
	expect(narrowForgot.x).toBeGreaterThan(
		narrowRemember.x + narrowRemember.width,
	)
	expect(narrowRemember.height).toBe(24)

	// The other title treatment is one class on the page's wrapper.
	await phone(page)
	await page.evaluate(() =>
		document.querySelector('.group\\/out')!.classList.add('title-centred'),
	)
	await expect(title).toHaveCSS('font-size', '32px')
	await expect(title).toHaveCSS('text-align', 'center')
	await expect(lead).toHaveCSS('text-align', 'center')
	await page.evaluate(() =>
		document.querySelector('.group\\/out')!.classList.remove('title-centred'),
	)

	await page.setViewportSize({ width: 767, height: 844 })
	await expect(title).toHaveCSS('font-size', '28px')
	expect((await box(logIn)).height).toBe(48)
	// The column stops at 448px and stays in the middle.
	const bandMain = await box(main)
	const bandField = await box(username)
	expect(bandField.width).toBe(448)
	expect(bandField.x - bandMain.x).toBeCloseTo((bandMain.width - 448) / 2, 0)
	expect((await box(title)).x).toBe(bandField.x)

	await wider(page)
	await expect(title).toHaveCSS('font-size', '24px')
	await expect(title).toHaveCSS('text-align', 'center')
	await expect(lead).toHaveCSS('font-size', '18px')
	await expect(forgot).toHaveCSS('font-size', '14px')
	expect((await box(forgot)).height).toBeLessThan(44)
	expect((await box(logIn)).height).toBe(44)
	expect((await box(passkey)).height).toBe(44)
	expect((await box(demo)).height).toBe(44)
	expect((await box(create)).height).toBe(24)
	expect((await box(username)).width).toBe(384)
})

test('signing up reads in the phone sizes from the email to the new account’s form', async ({
	page,
}) => {
	// Long enough to need two lines on a 320px phone.
	const email =
		`a.long.address.for.a.narrow.phone.${createUser().email}`.toLowerCase()
	try {
		await page.goto('/signup')
		const main = page.locator('#main-content')
		const title = page.getByRole('heading', { level: 1 })
		const trial = page.getByText(/^Free to use\./)
		const emailMe = page.getByRole('button', { name: 'Email me a code' })
		const haveAccount = page.getByText('Already have an account?')
		const logInLink = main.getByRole('link', { name: 'Log in' })
		await hydrated(emailMe)
		await fontsReady(page)

		await expect(title).toHaveCSS('font-size', '28px')
		await expect(trial).toHaveCSS('font-size', '13.5px')
		await expect(haveAccount).toHaveCSS('font-size', '16px')
		await expect(logInLink).toHaveCSS('font-size', '16px')
		expect((await box(logInLink)).height).toBe(44)
		const emailMeBox = await box(emailMe)
		expect(emailMeBox.height).toBe(48)
		expect((await box(logInLink)).y).toBeGreaterThanOrEqual(
			emailMeBox.y + emailMeBox.height,
		)
		// From the field to the button.
		const emailField = await box(page.getByLabel('Email'))
		expect(emailMeBox.y - (emailField.y + emailField.height)).toBe(32)
		expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '28px'])
		// From the title to its paragraph, and from the small line to the field.
		const signupTitle = await box(title)
		const signupLead = await box(page.getByText(/^We'll email you a code/))
		const trialBox = await box(trial)
		const emailLabel = await box(page.getByText('Email', { exact: true }))
		expect(signupLead.y - (signupTitle.y + signupTitle.height)).toBeCloseTo(
			8,
			0,
		)
		expect(emailLabel.y - (trialBox.y + trialBox.height)).toBeCloseTo(24, 0)

		// Up to 767px the title and the form share a 448px column.
		await page.setViewportSize({ width: 767, height: 844 })
		const bandField = await box(page.getByLabel('Email'))
		expect(bandField.width).toBe(448)
		expect((await box(title)).x).toBe(bandField.x)
		expect((await box(emailMe)).height).toBe(48)

		await wider(page)
		await expect(title).toHaveCSS('font-size', '24px')
		await expect(trial).toHaveCSS('font-size', '14px')
		await expect(logInLink).toHaveCSS('font-size', '14px')
		expect((await box(emailMe)).height).toBe(44)

		// The code screen.
		await phone(page)
		await page.getByLabel('Email').fill(email)
		await emailMe.click()
		await expect(page).toHaveURL(/\/verify/)
		const note = page.getByText(/^Asked more than once\?/)
		const code = page.getByRole('textbox', { name: 'Code' })
		const submit = main.getByRole('button', { name: 'Submit' })
		const slots = page.locator('[data-slot=input-otp-slot]')
		await expect(slots).toHaveCount(8)
		await fontsReady(page)
		await code.fill('K7M2')

		await expect(title).toHaveCSS('font-size', '28px')
		await expect(title).toHaveCSS('text-align', 'left')
		await expect(note).toHaveCSS('font-size', '13.5px')
		await expect(slots.first()).toHaveCSS('font-size', '20px')
		const slot = await box(slots.first())
		const lastSlot = await box(slots.last())
		expect(slot.height).toBe(44)
		expect(slot.width).toBeLessThanOrEqual(44)
		// The boxes start on the title's edge.
		expect(slot.x).toBe((await box(title)).x)
		const submitBox = await box(submit)
		expect(submitBox.height).toBe(48)
		expect(submitBox.width).toBe((await box(main)).width - 32)
		expect(submitBox.y - (slot.y + slot.height)).toBe(32)
		expect(lastSlot.x + lastSlot.width).toBeLessThanOrEqual(
			submitBox.x + submitBox.width,
		)
		expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '20px', '28px'])
		const noteBox = await box(note)
		const codeLabel = await box(page.getByText('Code', { exact: true }))
		expect(codeLabel.y - (noteBox.y + noteBox.height)).toBeCloseTo(24, 0)

		// In the other title treatment the boxes are centred too.
		await page.evaluate(() =>
			document.querySelector('.group\\/out')!.classList.add('title-centred'),
		)
		const centredFirst = await box(slots.first())
		const centredLast = await box(slots.last())
		const mainBox = await box(main)
		expect(centredFirst.x - mainBox.x).toBeCloseTo(
			mainBox.x + mainBox.width - (centredLast.x + centredLast.width),
			0,
		)
		await page.evaluate(() =>
			document.querySelector('.group\\/out')!.classList.remove('title-centred'),
		)

		// A box stops growing at 44px in the wide end of the phone sizes.
		await page.setViewportSize({ width: 767, height: 844 })
		expect((await box(slots.first())).width).toBeLessThanOrEqual(44)
		expect((await box(submit)).width).toBe(448)

		await wider(page)
		await expect(note).toHaveCSS('font-size', '16px')
		await expect(slots.first()).toHaveCSS('font-size', '14px')
		expect((await box(slots.first())).height).toBe(40)
		expect((await box(submit)).height).toBe(44)
		expect((await box(submit)).width).toBe(320)

		// The new account's form.
		await phone(page)
		const message = await waitFor(() => readEmail(email), { timeout: 10_000 })
		await page.goto(extractUrl(message.text)!)
		await hydrated(submit)
		await submit.click()
		await expect(page).toHaveURL(/\/onboarding/)
		const address = page.getByText(email, { exact: true })
		const consent = page.getByText(
			'I agree to the Terms of Service and Privacy Policy',
		)
		const remember = page.getByText('Remember me', { exact: true })
		const createAccount = page.getByRole('button', {
			name: 'Create an account',
		})
		await fontsReady(page)
		const ink = await page.evaluate(() => getComputedStyle(document.body).color)

		await expect(title).toHaveCSS('font-size', '28px')
		await expect(address).toHaveCSS('font-size', '16px')
		await expect(address).toHaveCSS('color', ink)
		await expect(page.getByText(/^Signing up as/)).not.toHaveCSS('color', ink)
		await expect(consent).toHaveCSS('font-size', '16px')
		const name = page.getByLabel('Name', { exact: true })
		const signingUp = await box(page.getByText(/^Signing up as/))
		const onboardingTitle = await box(title)
		const firstLabel = await box(page.getByText('Username', { exact: true }))
		expect(
			signingUp.y - (onboardingTitle.y + onboardingTitle.height),
		).toBeCloseTo(8, 0)
		expect(firstLabel.y - (signingUp.y + signingUp.height)).toBe(24)
		// A long address breaks inside the column of a 320px phone.
		await page.setViewportSize({ width: 335, height: 844 })
		const narrowMain = await box(main)
		const narrowAddress = await box(address)
		expect(narrowAddress.x + narrowAddress.width).toBeLessThanOrEqual(
			narrowMain.x + narrowMain.width - 16,
		)
		// Up to 767px the title and the form share a 448px column.
		await page.setViewportSize({ width: 767, height: 844 })
		const bandName = await box(name)
		expect(bandName.width).toBe(448)
		expect((await box(title)).x).toBe(bandName.x)
		await phone(page)
		const createBox = await box(createAccount)
		const rememberBox = await box(remember)
		expect(createBox.height).toBe(48)
		expect(createBox.y - (rememberBox.y + rememberBox.height)).toBe(32)
		expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '28px'])

		await wider(page)
		await expect(title).toHaveCSS('font-size', '24px')
		await expect(address).toHaveCSS('font-size', '18px')
		await expect(address).not.toHaveCSS('color', ink)
		expect((await box(createAccount)).height).toBe(44)
	} finally {
		await prisma.emailCode.deleteMany({ where: { target: email } })
	}
})

test('Forgot password reads in the phone sizes before and after it sends', async ({
	page,
}) => {
	await page.goto('/forgot-password')
	const title = page.getByRole('heading', { level: 1 })
	const send = page.getByRole('button', { name: 'Email me a link' })
	const back = page.getByRole('link', { name: 'Back to log in' })
	await hydrated(send)
	await fontsReady(page)
	const ink = await page.evaluate(() => getComputedStyle(document.body).color)

	await expect(title).toHaveCSS('font-size', '28px')
	const sendBox = await box(send)
	const backLink = await box(back)
	const lead = await box(page.getByText(/^We'll email you a link/))
	const label = await box(page.getByText('Username or email', { exact: true }))
	expect(label.y - (lead.y + lead.height)).toBe(24)
	expect(sendBox.height).toBe(48)
	expect(backLink.height).toBe(44)
	// Its line is 24px under the button.
	expect(backLink.y + 10 - (sendBox.y + sendBox.height)).toBe(24)
	expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '28px'])

	await page.getByLabel('Username or email').fill('nobodyhere')
	await send.click()
	const check = page.getByText('Check your email.')
	const note = page.getByText(/^Asked more than once\?/)
	await expect(check).toBeVisible()
	await expect(check).toHaveCSS('font-size', '17px')
	await expect(check).toHaveCSS('color', ink)
	await expect(check).toHaveCSS('text-align', 'left')
	await expect(note).toHaveCSS('font-size', '13.5px')
	await expect(note).toHaveCSS('text-align', 'left')
	const backBox = await box(back)
	expect(backBox.height).toBe(44)
	expect(await sizesInMain(page)).toEqual(['13.5px', '16px', '17px', '28px'])

	await wider(page)
	await expect(check).toHaveCSS('font-size', '18px')
	await expect(check).not.toHaveCSS('color', ink)
	await expect(note).toHaveCSS('font-size', '16px')
	await expect(note).toHaveCSS('text-align', 'center')
	expect((await box(back)).height).toBe(24)
})

test.describe('in the iOS app', () => {
	test.use({ userAgent: SHELL_UA })

	test('Log in keeps its button 32px under the row that has lost Remember me', async ({
		page,
	}) => {
		await page.goto('/login')
		const logIn = page.getByRole('button', { name: 'Log in', exact: true })
		const forgot = page.getByRole('link', { name: 'Forgot password?' })
		await hydrated(logIn)
		await fontsReady(page)
		await expect(page.getByText('Remember me')).toHaveCount(0)
		const forgotBox = await box(forgot)
		// The link's line is the middle 24px of its 44px tap area.
		const lineBottom = forgotBox.y + forgotBox.height / 2 + 12
		expect((await box(logIn)).y - lineBottom).toBe(32)
	})
})

// A phone as the code field's library sees one: no scrollbar gutter, and a
// window no wider than the page.
test.describe('on a 320px phone', () => {
	test.use({
		viewport: { width: 320, height: 568 },
		isMobile: true,
		hasTouch: true,
	})

	test('the six boxes of a 2FA code fit the page', async ({
		page,
		insertNewUser,
	}) => {
		const password = 'signed-out-sizes-1'
		const user = await insertNewUser({ password })
		await prisma.verification.create({
			data: {
				type: '2fa',
				target: user.id,
				secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
				algorithm: 'SHA-1',
				digits: 6,
				period: 30,
				charSet: '0123456789',
			},
		})
		await page.goto('/login')
		const logIn = page.getByRole('button', { name: 'Log in', exact: true })
		await hydrated(logIn)
		await page.getByLabel('Username').fill(user.username)
		await page.getByLabel('Password').fill(password)
		await logIn.click()
		await expect(page).toHaveURL(/\/verify/)
		const slots = page.locator('[data-slot=input-otp-slot]')
		await expect(slots).toHaveCount(6)
		await fontsReady(page)

		const slot = await box(slots.first())
		expect(slot.height).toBe(44)
		expect(slot.width).toBe(44)
		await expect(slots.first()).toHaveCSS('font-size', '20px')
		expect(slot.x).toBe((await box(page.getByRole('heading', { level: 1 }))).x)
		// The last box ends inside the column.
		const last = await box(slots.last())
		expect(last.x + last.width).toBeLessThanOrEqual(320 - 16)
	})
})
