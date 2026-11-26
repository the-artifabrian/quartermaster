import { cn } from '#app/utils/misc.tsx'

/** A section divider: a 1px hairline in the border color. */
export function Divider({ className }: { className?: string }) {
	return <hr className={cn('border-border border-t', className)} />
}
