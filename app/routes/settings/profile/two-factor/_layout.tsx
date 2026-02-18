import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { Outlet } from 'react-router'
import { type VerificationTypes } from '#app/routes/_auth/verify.tsx'
import { type SettingsPageHandle } from '../../profile/_layout.tsx'

export const handle: SettingsPageHandle & SEOHandle = {
	pageTitle: 'Two-Factor Auth',
	getSitemapEntries: () => null,
}

export const twoFAVerificationType = '2fa' satisfies VerificationTypes

export default function TwoFactorRoute() {
	return <Outlet />
}
