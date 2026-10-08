import { type SEOHandle } from '@nasa-gcn/remix-seo'
import { useEffect, useRef, useState } from 'react'
import {
	Form,
	Link,
	useActionData,
	useNavigation,
	useSubmit,
} from 'react-router'
import { ImportRecipeReview } from '#app/components/import-recipe-review.tsx'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Input } from '#app/components/ui/input.tsx'
import { Label } from '#app/components/ui/label.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { type ExtractedRecipe } from '#app/utils/import-recipe-types.ts'
import { useIsNativeShell } from '#app/utils/request-info.ts'
import { useFitFileInput } from '#app/utils/downscale-image.ts'
import { importUrlFromSearch } from '#app/utils/import-url.ts'
import { recipeMetadataOptions } from '#app/utils/recipe-metadata.server.ts'
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
	const { householdId, isProActive } = await requireUserWithTier(request)
	return {
		isProActive,
		metadataOptions: await recipeMetadataOptions(householdId),
		sharedUrl: importUrlFromSearch(new URL(request.url).search),
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
	const submittingIntent =
		isSubmitting && navigation.formData
			? navigation.formData.get('intent')
			: null

	const [review, setReview] = useState<ExtractedRecipe | null>(null)
	if (!review && actionData?.recipe) setReview(actionData.recipe)
	const recipe = review
	const error = actionData && 'error' in actionData ? actionData.error : null
	const actionIntent =
		actionData && 'intent' in actionData ? actionData.intent : null
	const duplicates =
		actionData && 'duplicates' in actionData ? actionData.duplicates : null
	const hasRecipe = recipe !== null

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
					: 'Paste a Recipe URL or its text, or upload screenshots.'}
			</p>

			{/* Input forms */}
			<fieldset hidden={hasRecipe} disabled={isSubmitting}>
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

			{/* Preview & Save */}
			{hasRecipe && (
				<div className="space-y-6">
					{duplicates && duplicates.length > 0 && (
						<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/50">
							<div className="flex items-start gap-3">
								<Icon
									name="question-mark-circled"
									className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
								/>
								<div className="space-y-2">
									<p className="font-medium text-amber-800 dark:text-amber-200">
										You may already have this recipe
									</p>
									<ul className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
										{duplicates.map((dup) => (
											<li key={dup.id}>
												<Link
													to={`/recipes/${dup.id}`}
													target="_blank"
													className="underline hover:no-underline"
												>
													{dup.title}
												</Link>{' '}
												<span className="text-amber-600 dark:text-amber-400">
													(
													{dup.matchReason === 'same-url'
														? 'same URL'
														: 'same title'}
													)
												</span>
											</li>
										))}
									</ul>
									<p className="text-sm text-amber-600 dark:text-amber-400">
										You can still save this recipe if you'd like a second copy.
									</p>
								</div>
							</div>
						</div>
					)}

					<ImportRecipeReview
						recipe={recipe!}
						metadataOptions={loaderData.metadataOptions}
					/>
				</div>
			)}
		</div>
	)
}
