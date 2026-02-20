import { Icon } from '#app/components/ui/icon.tsx'

export function RecipeMetadataCard({
	prepTime,
	cookTime,
	sourceUrl,
}: {
	prepTime: number | null
	cookTime: number | null
	sourceUrl: string | null
}) {
	const totalTime = (prepTime ?? 0) + (cookTime ?? 0)

	if (!prepTime && !cookTime && !sourceUrl) return null

	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm print:mt-1">
			{prepTime && (
				<span className="text-muted-foreground flex items-center gap-1">
					<Icon name="clock" size="sm" className="text-muted-foreground/70" />
					Prep: {prepTime} min
				</span>
			)}
			{cookTime && (
				<>
					{prepTime && (
						<span className="text-border hidden md:inline">·</span>
					)}
					<span className="text-muted-foreground flex items-center gap-1">
						<Icon name="clock" size="sm" className="text-muted-foreground/70" />
						Cook: {cookTime} min
					</span>
				</>
			)}
			{totalTime > 0 && (
				<>
					<span className="text-border hidden md:inline">·</span>
					<span className="text-foreground/80 font-medium">
						Total: {totalTime} min
					</span>
				</>
			)}
			{sourceUrl && (
				<>
					{(prepTime || cookTime) && (
						<span className="text-border hidden md:inline">·</span>
					)}
					<a
						href={sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline"
					>
						<Icon name="link-2" size="sm" />
						{(() => {
							try {
								return new URL(sourceUrl).hostname.replace(/^www\./, '')
							} catch {
								return 'Source'
							}
						})()}
					</a>
				</>
			)}
		</div>
	)
}
