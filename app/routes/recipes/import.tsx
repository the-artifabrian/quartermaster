import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import {
	Form,
	Link,
	useActionData,
	useNavigation,
	useSubmit,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useFitFileInput } from '#app/utils/downscale-image.ts'
import { importUrlFromSearch } from '#app/utils/import-url.ts'
import { MAX_IMPORT_IMAGE_SIZE } from '#app/utils/recipe-validation.ts'
import { requireUserWithTier } from '#app/utils/subscription.server.ts'
import { type Route } from './+types/import.ts'
import { importAction } from './import-action.server.ts'

export const handle: SEOHandle = {
	getSitemapEntries: () => null,
}

export const meta: Route.MetaFunction = () => {
	return [{ title: 'Import Recipe | Quartermaster' }]
}

type ImportTab = 'url' | 'text' | 'image'

export async function loader({ request }: Route.LoaderArgs) {
	const { isProActive } = await requireUserWithTier(request)
	return {
		isProActive,
		sharedUrl: importUrlFromSearch(new URL(request.url).search),
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

export default function ImportRecipe({ loaderData }: Route.ComponentProps) {
	const { isProActive, sharedUrl } = loaderData
	const actionData = useActionData<typeof action>()
	const navigation = useNavigation()
	const submit = useSubmit()
	const autoFetched = useRef(false)

	// A share sheet opens this page with ?url=…, so fetch that page once. The
	// fetch posts to the bare path and replaces this history entry, so the
	// address no longer carries the URL: going back to the import page, or
	// reloading it, shows an empty form instead of fetching again. The ref
	// stops a second effect run in the same visit from posting twice.
	useEffect(() => {
		if (!sharedUrl || autoFetched.current) return
		autoFetched.current = true
		void submit(
			{ intent: 'fetch', url: sharedUrl },
			{ method: 'POST', action: '/recipes/import', replace: true },
		)
	}, [sharedUrl, submit])

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
	const submittingIntent = navigation.formData?.get('intent') ?? null

	const error = actionData?.error ?? null
	const actionIntent = actionData?.intent ?? null
	const existing = actionData?.existing ?? null

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
	const hideAi = useIsNativeShell() && !isProActive
	const visibleTab = hideAi && activeTab === 'image' ? 'url' : activeTab

	return (
		<div className="container max-w-2xl py-6 pb-[calc(var(--bottom-nav-h)+1rem+var(--bottom-nav-inset))] md:pb-6">
			<h1 className="mb-2 font-serif text-2xl font-normal">Import Recipe</h1>
			<p className="text-muted-foreground mb-6">
				{hideAi
					? 'Paste a Recipe URL or its text.'
					: 'Paste a Recipe URL or its text, or upload screenshots.'}{' '}
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
					<p className="font-serif text-lg">{progress.title}</p>
					{progress.hint ? (
						<p className="text-muted-foreground text-sm">{progress.hint}</p>
					) : null}
					<p className="text-muted-foreground text-sm">
						It opens as soon as it’s saved.
					</p>
				</div>
			) : null}

			{existing && !progress ? (
				<div role="status" className="bg-muted/40 mb-6 rounded-lg p-4">
					<p className="font-medium">Already in your Recipes</p>
					<p className="text-muted-foreground mt-1 text-sm wrap-anywhere">
						You imported this link before as “{existing.title}”.
					</p>
					<Button asChild size="sm" className="mt-3">
						<Link to={`/recipes/${existing.id}`}>Open it</Link>
					</Button>
				</div>
			) : null}

			{/* Input forms stay mounted while an import runs, so a failed one
			    comes back with everything that was typed or picked. */}
			<fieldset hidden={progress !== null} disabled={isSubmitting}>
				{/* Tab bar */}
				<div className="mb-6 flex gap-1 rounded-lg border p-1">
					<button
						type="button"
						className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
							visibleTab === 'url'
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:text-foreground'
						}`}
						onClick={() => setActiveTab('url')}
					>
						From URL
					</button>
					<button
						type="button"
						className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
							visibleTab === 'text'
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:text-foreground'
						}`}
						onClick={() => setActiveTab('text')}
					>
						From Text
					</button>
					{!hideAi && (
						<button
							type="button"
							className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
								activeTab === 'image'
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground hover:text-foreground'
							}`}
							onClick={() => setActiveTab('image')}
						>
							From Image
						</button>
					)}
				</div>

				{/* URL tab */}
				{visibleTab === 'url' && (
					// The bare path, so a submit before hydration also drops ?url=
					// and the auto-fetch cannot follow it.
					<Form method="POST" action="/recipes/import" className="space-y-4">
						<input type="hidden" name="intent" value="fetch" />
						<div className="space-y-2">
							<Label htmlFor="url">Recipe URL</Label>
							<Input
								id="url"
								name="url"
								type="url"
								placeholder="https://example.com/recipe/..."
								defaultValue={sharedUrl ?? undefined}
								autoFocus
								required
							/>
						</div>
						{urlError && (
							<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
								{urlError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => history.back()}
							>
								Cancel
							</Button>
							<StatusButton
								type="submit"
								status={submittingIntent === 'fetch' ? 'pending' : 'idle'}
								disabled={isSubmitting}
							>
								{submittingIntent === 'fetch' ? 'Fetching...' : 'Fetch Recipe'}
							</StatusButton>
						</div>
					</Form>
				)}

				{/* Text tab */}
				{visibleTab === 'text' && (
					<Form method="POST" className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="rawText">Recipe text</Label>
							<Textarea
								id="rawText"
								name="rawText"
								placeholder={
									'Paste a recipe from social media, a blog post, or any text source...'
								}
								rows={8}
							/>
						</div>
						{textError && (
							<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
								{textError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => history.back()}
							>
								Cancel
							</Button>
							<StatusButton
								type="submit"
								name="intent"
								value="parse-text"
								variant="outline"
								status={submittingIntent === 'parse-text' ? 'pending' : 'idle'}
								disabled={isSubmitting}
							>
								{submittingIntent === 'parse-text'
									? 'Parsing...'
									: 'Parse Recipe'}
							</StatusButton>
							{isProActive ? (
								<StatusButton
									type="submit"
									name="intent"
									value="extract-text"
									status={
										submittingIntent === 'extract-text' ? 'pending' : 'idle'
									}
									disabled={isSubmitting}
								>
									<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
									{submittingIntent === 'extract-text'
										? 'Extracting...'
										: 'Extract with AI'}
								</StatusButton>
							) : hideAi ? null : (
								<Button asChild>
									<Link to="/upgrade">
										<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
										Extract with AI
										<span className="bg-primary-foreground text-primary ml-2 rounded px-1.5 py-0.5 text-xs font-medium">
											Pro
										</span>
									</Link>
								</Button>
							)}
						</div>
					</Form>
				)}

				{/* Image tab */}
				{visibleTab === 'image' && (
					<Form
						method="POST"
						encType="multipart/form-data"
						className="space-y-4"
					>
						<input type="hidden" name="intent" value="extract-image" />
						<div className="space-y-2">
							<Label htmlFor="image">Upload screenshots (up to 5)</Label>
							<Input
								id="image"
								name="image"
								type="file"
								accept="image/jpeg,image/png,image/webp"
								multiple
								onChange={(event) => void fitImages(event.currentTarget)}
							/>
							<p className="text-muted-foreground text-xs">
								JPEG, PNG, or WebP. Large images are resized. Multiple images
								will be combined into one recipe.
							</p>
						</div>
						{imageError && (
							<div className="border-destructive bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
								{imageError}
							</div>
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => history.back()}
							>
								Cancel
							</Button>
							{isProActive ? (
								<StatusButton
									type="submit"
									status={
										submittingIntent === 'extract-image' ? 'pending' : 'idle'
									}
									disabled={isSubmitting || preparingImages}
								>
									<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
									{submittingIntent === 'extract-image'
										? 'Extracting...'
										: 'Extract with AI'}
								</StatusButton>
							) : (
								<Button asChild>
									<Link to="/upgrade">
										<Icon name="sparkles" className="mr-1.5 inline h-4 w-4" />
										Extract with AI
										<span className="bg-primary-foreground text-primary ml-2 rounded px-1.5 py-0.5 text-xs font-medium">
											Pro
										</span>
									</Link>
								</Button>
							)}
						</div>
					</Form>
				)}
			</fieldset>
		</div>
	)
}
