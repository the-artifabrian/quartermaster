export const launchThemes = {
	light: {
		canvas: '#f6f1eb',
		foreground: '#2d2926',
		mutedForeground: '#6f6358',
	},
	dark: {
		canvas: '#1a1816',
		foreground: '#e2dbd1',
		mutedForeground: '#b5a99b',
	},
} as const

export type LaunchTheme = keyof typeof launchThemes

export const launchThemeNames = Object.keys(launchThemes) as LaunchTheme[]
export const iosStartupLogoScale = 0.18

// Portrait viewport sizes used by currently supported iPhones. A single image
// can cover multiple models that share the same CSS viewport and pixel ratio.
export const iosStartupScreens = [
	{
		devices: 'iPhone 17 Pro Max / 16 Pro Max',
		width: 440,
		height: 956,
		dpr: 3,
	},
	{ devices: 'iPhone 17 / 17 Pro / 16 Pro', width: 402, height: 874, dpr: 3 },
	{ devices: 'iPhone Air', width: 420, height: 912, dpr: 3 },
	{
		devices: 'iPhone 16 Plus / 15 Plus / 14 Pro Max',
		width: 430,
		height: 932,
		dpr: 3,
	},
	{
		devices: 'iPhone 16 / 15 / 15 Pro / 14 Pro',
		width: 393,
		height: 852,
		dpr: 3,
	},
	{
		devices: 'iPhone 14 Plus / 13 Pro Max / 12 Pro Max',
		width: 428,
		height: 926,
		dpr: 3,
	},
	{
		devices: 'iPhone 14 / 13 / 13 Pro / 12 / 12 Pro',
		width: 390,
		height: 844,
		dpr: 3,
	},
	{ devices: 'iPhone 13 mini / 12 mini', width: 360, height: 780, dpr: 3 },
	{ devices: 'iPhone 11 Pro Max / XS Max', width: 414, height: 896, dpr: 3 },
	{ devices: 'iPhone 11 / XR', width: 414, height: 896, dpr: 2 },
	{ devices: 'iPhone 11 Pro / XS / X', width: 375, height: 812, dpr: 3 },
	{ devices: 'iPhone SE / 8 / 7 / 6s', width: 375, height: 667, dpr: 2 },
	{ devices: 'iPhone 8 Plus / 7 Plus', width: 414, height: 736, dpr: 3 },
] as const

export function getIosStartupImage(
	screen: (typeof iosStartupScreens)[number],
	theme: LaunchTheme,
) {
	const pixelWidth = screen.width * screen.dpr
	const pixelHeight = screen.height * screen.dpr

	return {
		href: `/splash/${theme}-${pixelWidth}x${pixelHeight}.png`,
		media: `(device-width: ${screen.width}px) and (device-height: ${screen.height}px) and (-webkit-device-pixel-ratio: ${screen.dpr}) and (prefers-color-scheme: ${theme})`,
		pixelWidth,
		pixelHeight,
	}
}

export const iosStartupImages = iosStartupScreens.flatMap((screen) =>
	launchThemeNames.map((theme) => ({
		...getIosStartupImage(screen, theme),
		theme,
	})),
)
