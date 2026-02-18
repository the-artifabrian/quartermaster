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
		<div className="bg-card shadow-warm-lg mt-4 rounded-2xl border p-3 md:p-5 print:border-0 print:p-2 print:shadow-none">
			<div className="flex flex-wrap items-center gap-3 text-sm">
				{prepTime && (
					<span className="text-muted-foreground flex items-center gap-1">
						<Icon name="clock" size="sm" className="text-accent" />
						Prep: {prepTime} min
					</span>
				)}
				{cookTime && (
					<>
						{prepTime && (
							<span className="text-border hidden md:inline">|</span>
						)}
						<span className="text-muted-foreground flex items-center gap-1">
							<Icon name="clock" size="sm" className="text-accent" />
							Cook: {cookTime} min
						</span>
					</>
				)}
				{totalTime > 0 && (
					<>
						<span className="text-border hidden md:inline">|</span>
						<span className="text-foreground font-medium">
							Total: {totalTime} min
						</span>
					</>
				)}

				{/* Source URL inline */}
				{sourceUrl && (
					<>
						{(prepTime || cookTime) && (
							<span className="text-border hidden md:inline">|</span>
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
		</div>
	)
}
