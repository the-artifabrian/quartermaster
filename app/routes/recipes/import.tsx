import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { type NavBarHandle } from '#app/components/nav-bar.tsx'
import { recipeImportNav } from '#app/utils/nav-back.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { data, Form, Link, useActionData, useNavigation } from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import {
	SegmentedControl,
	tabPanelProps,
} from '#app/components/ui/segmented-control.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useFitFileInput } from '#app/utils/downscale-image.ts'
import { findRecipeFromUrl } from '#app/utils/import-recipe-save.server.ts'
import { importUrlFromSearch } from '#app/utils/import-url.ts'
import { isNetworkFailure } from '#app/utils/network-failure.ts'
import {
	MAX_IMPORT_IMAGE_COUNT,
	MAX_IMPORT_IMAGE_SIZE,
} from '#app/utils/recipe-validation.ts'
import {
	currentSharePage,
	discardShareImport,
	dropStaleShareImport,
	SHARE_IMPORT_EVENT,
	takeShareImport,
} from '#app/utils/shell-bridge.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/import.ts'
import { importAction } from './import-action.server.ts'
import { PushLink } from '#app/components/push-link.tsx'

export const handle: SEOHandle & NavBarHandle = {
	getSitemapEntries: () => null,
	nav: recipeImportNav,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Import Recipe | Quartermaster' }]
}

type ImportTab = 'url' | 'text' | 'image'

export async function loader({ request }: Route.LoaderArgs) {
	const { isProActive, householdId } = await requireUserWithTier(request)
	const sharedUrl = importUrlFromSearch(new URL(request.url).search)
	return {
		isProActive,
		sharedUrl,
		// A shared link the household already has says so straight away. Only
		// a read, so it is safe on load, unlike the import itself.
		sharedExisting: sharedUrl
			? await findRecipeFromUrl(householdId, sharedUrl)
			: null,
	}
}

// Not URL.canParse: this runs in the browser, and Safari before 17 lacks it.
function hostOf(url: string | null) {
	try {
		return url ? new URL(url).hostname.replace(/^www\./, '') : null
	} catch {
		return null
	}
}

/** What the page says while an import reads its source and saves it. */
function importProgress(intent: string, url: string | null) {
	const host = hostOf(url)
	switch (intent) {
		case 'fetch':
			return {
				title: host ? `Importing from ${host}…` : 'Importing the page…',
				hint: null,
			}
		case 'parse-text':
			return { title: 'Reading your text…', hint: null }
		case 'extract-text':
			return {
				title: 'Reading your text with AI…',
				hint: 'This can take a little while.',
			}
		case 'extract-image':
			return {
				title: 'Reading your screenshots…',
				hint: 'This can take a little while.',
			}
		default:
			return null
	}
}

export async function action({ request }: Route.ActionArgs) {
	return importAction(request)
}

const IMPORT_INTENTS = new Set([
	'fetch',
	'parse-text',
	'extract-text',
	'extract-image',
])

/**
 * An import that got no answer (offline, a dropped connection, the app put
 * away mid-import) comes back as that tab's error, so what was typed, picked
 * or shared stays on the page. The server may still have saved it, so the
 * message says to look first. A 503, so the loaders do not run again into the
 * same dead connection. Anything else, a redirect included, goes on as before.
 */
export async function clientAction({
	request,
	serverAction,
}: Route.ClientActionArgs) {
	const intent = (await request.clone().formData()).get('intent')
	try {
		return await serverAction()
	} catch (error) {
		if (!isNetworkFailure(error) || typeof intent !== 'string') throw error
		if (!IMPORT_INTENTS.has(intent)) throw error
		return data(
			{
				intent: intent as
					'fetch' | 'parse-text' | 'extract-text' | 'extract-image',
				error:
					'Couldn’t reach Quartermaster to confirm the import. Check your Recipes before you try again.',
				existing: null,
			},
			{ status: 503 },
		)
	}
}

/**
 * What the iOS app's own Share Extension shares imports at once, as if Import
 * had been tapped: a link on the page that offers that link, screenshots on
 * the plain import page. Only the shell can hand a share over (iOS README,
 * "Share import"); a link from a site or another app, or a typed URL, still
 * waits for the tap.
 */
function useShareImport({
	enabled,
	sharedUrl,
	idle,
	offerShowing,
	importLink,
	importImages,
}: {
	enabled: boolean
	sharedUrl: string | null
	/** No navigation or submission in flight. */
	idle: boolean
	/** The page offers its shared link ("Import this Recipe?"). */
	offerShowing: boolean
	importLink: () => void
	importImages: (files: File[]) => void
}) {
	useEffect(() => {
		if (!enabled) return
		function take() {
			// The router moves the URL before this page renders the new one;
			// the effect runs again for that render.
			if (importUrlFromSearch(window.location.search) !== sharedUrl) return
			// A share handed to another page, or too long ago, never acts.
			const where = currentSharePage()
			dropStaleShareImport(where)
			// A navigation in flight may still take the page away: the share
			// waits, and the effect runs again once it settles. If the page
			// goes, it goes with it (below).
			if (!idle) return
			const share = takeShareImport(MAX_IMPORT_IMAGE_COUNT, where)
			if (!share) return
			if (share.kind === 'link') {
				if (share.url === sharedUrl && offerShowing) importLink()
			} else if (sharedUrl === null) {
				importImages(share.files)
			}
		}
		take()
		window.addEventListener(SHARE_IMPORT_EVENT, take)
		return () => window.removeEventListener(SHARE_IMPORT_EVENT, take)
	}, [enabled, sharedUrl, idle, offerShowing, importLink, importImages])

	// A share handed over while this page was being left never outlives it.
	useEffect(() => discardShareImport, [])
}

export default function ImportRecipe({ loaderData }: Route.ComponentProps) {
	const { isProActive, sharedUrl, sharedExisting } = loaderData
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()

	const isSubmitting = navigation.state !== 'idle'
	// An import's submission, until the Recipe it saved has loaded.
	const progress =
		navigation.formAction?.split('?')[0] === '/recipes/import' &&
		navigation.formData
			? importProgress(
					String(navigation.formData.get('intent')),
					navigation.formData.get('url') as string | null,
				)
			: null

	const error = actionData?.error ?? null
	const actionIntent = actionData?.intent ?? null
	const existing = actionData ? actionData.existing : sharedExisting
	const offerShared =
		sharedUrl !== null && !sharedExisting && !actionData && progress === null

	const urlError = error && actionIntent === 'fetch' ? error : null
	const textError =
		error && (actionIntent === 'parse-text' || actionIntent === 'extract-text')
			? error
			: null
	const imageError = error && actionIntent === 'extract-image' ? error : null

	// Default to the tab that matches the last action
	const defaultTab: ImportTab =
		actionIntent === 'parse-text' || actionIntent === 'extract-text'
			? 'text'
			: actionIntent === 'extract-image'
				? 'image'
				: 'url'
	const [activeTab, setActiveTab] = useState<ImportTab>(defaultTab)
	const { preparing: preparingImages, fit: fitImages } = useFitFileInput(
		MAX_IMPORT_IMAGE_SIZE,
	)
	// The iOS app may not point at buying Pro (ADR 0001), so a free user there
	// gets the free URL and text imports without the AI extraction that leads
	// to Pro.
	const isNativeShell = useIsNativeShell()
	const hideAi = isNativeShell && !isProActive
	const visibleTab = hideAi && activeTab === 'image' ? 'url' : activeTab

	// A shared link goes through the offer's own form, and shared screenshots
	// through the image form, each submitted as a tap would.
	const offerForm = useRef<HTMLFormElement>(null)
	const imageForm = useRef<HTMLFormElement>(null)
	const imageInput = useRef<HTMLInputElement>(null)
	const [sharedImages, setSharedImages] = useState<File[] | null>(null)
	const [sharedImagesRefused, setSharedImagesRefused] = useState(false)
	const importSharedLink = useCallback(
		() => offerForm.current?.requestSubmit(),
		[],
	)
	const importSharedImages = useCallback(
		(files: File[]) => {
			// Screenshots are read by the AI extraction, which is Pro; the server
			// refuses it too.
			if (!isProActive) {
				setSharedImagesRefused(true)
				return
			}
			setSharedImagesRefused(false)
			setActiveTab('image')
			setSharedImages(files)
		},
		[isProActive],
	)
	useShareImport({
		enabled: isNativeShell,
		sharedUrl,
		idle: navigation.state === 'idle',
		offerShowing: offerShared,
		importLink: importSharedLink,
		importImages: importSharedImages,
	})
	// The image form is there once its tab shows. The files stay on its input,
	// so a failed import is one tap from trying again.
	useEffect(() => {
		const form = imageForm.current
		const input = imageInput.current
		if (!sharedImages || visibleTab !== 'image' || !form || !input) return
		const transfer = new DataTransfer()
		for (const file of sharedImages) transfer.items.add(file)
		input.files = transfer.files
		setSharedImages(null)
		form.requestSubmit()
	}, [sharedImages, visibleTab])

	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-2 font-serif text-2xl">Import Recipe</h1>
			<p className="text-muted-foreground mb-6">
				{hideAi
					? 'Paste a Recipe’s link or its text.'
					: 'Paste a Recipe’s link or its text, or upload screenshots.'}{' '}
				Quartermaster saves it to your Recipes, ready to edit.
			</p>

			{progress ? (
				<div
					role="status"
					className="flex flex-col items-center gap-2 py-16 text-center"
				>
					<Icon
						name="update"
						className="text-muted-foreground mb-2 size-6 animate-spin"
					/>
					<p className="text-lg font-medium">{progress.title}</p>
					{progress.hint ? (
						<p className="text-muted-foreground text-sm">{progress.hint}</p>
					) : null}
					<p className="text-muted-foreground text-sm">
						It opens as soon as it’s saved.
					</p>
				</div>
			) : null}

			{/* A share sheet opens this page with ?url=…. An import saves, and any
			    site can link here, so the link waits for a tap; it is never
			    fetched on load. A share through the iOS app's own Share
			    Extension submits it at once (useShareImport). The tap posts to
			    the bare path and replaces this history entry, so Back or a
			    reload never offers it again. */}
			{offerShared ? (
				<div className="bg-muted/40 mb-6 rounded-lg p-4">
					<h2 className="font-medium">Import this Recipe?</h2>
					<p className="text-muted-foreground mt-1 text-sm wrap-anywhere">
						{sharedUrl}
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<Form
							ref={offerForm}
							method="POST"
							action="/recipes/import"
							replace
						>
							<input type="hidden" name="intent" value="fetch" />
							<input type="hidden" name="url" value={sharedUrl} />
							<Button type="submit" size="sm" className="px-4">
								Import
							</Button>
						</Form>
						<Button asChild size="sm" variant="ghost">
							<Link to="/recipes/import" replace>
								Use another link
							</Link>
						</Button>
					</div>
				</div>
			) : null}

			{sharedImagesRefused && !progress ? (
				<div role="status" className="bg-muted/40 mb-6 rounded-lg p-4">
					<p className="font-medium">
						Screenshot import isn’t available on your account
					</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Paste the Recipe’s link or text instead.
					</p>
				</div>
			) : null}

			{existing && !progress ? (
				<div role="status" className="bg-muted/40 mb-6 rounded-lg p-4">
					<p className="font-medium">Already in your Recipes</p>
					<p className="text-muted-foreground mt-1 text-sm wrap-anywhere">
						It’s saved as “{existing.title}”.
					</p>
					<Button asChild size="sm" className="mt-3 px-4">
						<PushLink to={`/recipes/${existing.id}`}>Open it</PushLink>
					</Button>
				</div>
			) : null}

			{/* Input forms stay mounted while an import runs, so a failed one
			    comes back with everything that was typed or picked. */}
			<fieldset
				hidden={progress !== null || offerShared}
				disabled={isSubmitting}
			>
				<SegmentedControl
					role="tablist"
					idPrefix="import"
					aria-label="Import from"
					value={visibleTab}
					onValueChange={setActiveTab}
					options={[
						{ value: 'url', label: 'From link' },
						{ value: 'text', label: 'From text' },
						...(hideAi
							? []
							: [{ value: 'image' as const, label: 'From image' }]),
					]}
					className="mb-6 w-full"
				/>

				{visibleTab === 'url' && (
					// The bare path, so a shared ?url= never outlives a submit.
					<Form
						{...tabPanelProps('import', 'url')}
						method="POST"
						action="/recipes/import"
						className="space-y-4"
					>
						<input type="hidden" name="intent" value="fetch" />
						<div className="space-y-2">
							<Label htmlFor="url">Recipe link</Label>
							<Input
								id="url"
								name="url"
								type="url"
								placeholder="https://example.com/recipe"
								defaultValue={(!sharedExisting && sharedUrl) || undefined}
								autoFocus
								required
							/>
						</div>
						{urlError && (
							<div className="border-destructive bg-destructive/5 text-foreground-destructive rounded-lg border p-4 text-sm">
								{urlError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button type="submit">Import</Button>
						</div>
					</Form>
				)}

				{visibleTab === 'text' && (
					<Form
						{...tabPanelProps('import', 'text')}
						method="POST"
						className="space-y-4"
					>
						<div className="space-y-2">
							<Label htmlFor="rawText">Recipe text</Label>
							<Textarea
								id="rawText"
								name="rawText"
								placeholder={'Paste the ingredients and steps'}
								rows={8}
							/>
						</div>
						{textError && (
							<div className="border-destructive bg-destructive/5 text-foreground-destructive rounded-lg border p-4 text-sm">
								{textError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button
								type="submit"
								name="intent"
								value="parse-text"
								variant="outline"
							>
								Read as written
							</Button>
							{isProActive ? (
								<Button type="submit" name="intent" value="extract-text">
									<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
									Read with AI
								</Button>
							) : hideAi ? null : (
								<Button asChild>
									<PushLink to="/upgrade">
										<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
										Read with AI
										<span className="bg-primary-foreground text-primary-fill ml-2 rounded px-1.5 py-0.5 text-xs font-medium">
											Pro
										</span>
									</PushLink>
								</Button>
							)}
						</div>
					</Form>
				)}

				{visibleTab === 'image' && (
					<Form
						ref={imageForm}
						{...tabPanelProps('import', 'image')}
						method="POST"
						encType="multipart/form-data"
						className="space-y-4"
					>
						<input type="hidden" name="intent" value="extract-image" />
						<div className="space-y-2">
							<Label htmlFor="image">
								Upload screenshots (up to {MAX_IMPORT_IMAGE_COUNT})
							</Label>
							<Input
								ref={imageInput}
								id="image"
								name="image"
								type="file"
								accept="image/jpeg,image/png,image/webp"
								multiple
								onChange={(event) => void fitImages(event.currentTarget)}
							/>
							<p className="text-muted-foreground text-xs">
								JPG, PNG or WebP. Large images are resized. Several screenshots
								make one Recipe.
							</p>
						</div>
						{imageError && (
							<div className="border-destructive bg-destructive/5 text-foreground-destructive rounded-lg border p-4 text-sm">
								{imageError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							{isProActive ? (
								<Button type="submit" disabled={preparingImages}>
									<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
									Read with AI
								</Button>
							) : (
								<Button asChild>
									<PushLink to="/upgrade">
										<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
										Read with AI
										<span className="bg-primary-foreground text-primary-fill ml-2 rounded px-1.5 py-0.5 text-xs font-medium">
											Pro
										</span>
									</PushLink>
								</Button>
							)}
						</div>
					</Form>
				)}
			</fieldset>
		</div>
	)
}
