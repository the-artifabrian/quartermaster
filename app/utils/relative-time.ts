export function getRelativeTime(date: Date): string {
	const now = Date.now()
	const diffMs = now - date.getTime()
	const diffMin = Math.floor(diffMs / 60_000)
	if (diffMin < 1) return 'just now'
	if (diffMin < 60) return `${diffMin}m ago`
	const diffHr = Math.floor(diffMin / 60)
	if (diffHr < 24) return `${diffHr}h ago`
	const diffDay = Math.floor(diffHr / 24)
	if (diffDay < 7) return `${diffDay}d ago`
	return date.toLocaleDateString()
}
