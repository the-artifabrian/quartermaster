import { cn } from '#app/utils/misc.tsx'

const widthClasses = {
	narrow: 'container-narrow',
	content: 'container-content',
	grid: 'container-grid',
	landing: 'container-landing',
} as const

export function PageContainer({
	width,
	className,
	children,
	...props
}: {
	width: keyof typeof widthClasses
	className?: string
	children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn(widthClasses[width], className)} {...props}>
			{children}
		</div>
	)
}
