import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

export type PrototypeVariant = {
	key: string
	label: string
}

export function PrototypeSwitcher({
	variants,
	current,
}: {
	variants: PrototypeVariant[]
	current: string
}) {
	const [searchParams, setSearchParams] = useSearchParams()
	const currentIndex = Math.max(
		0,
		variants.findIndex((variant) => variant.key === current),
	)

	function select(index: number) {
		const next = new URLSearchParams(searchParams)
		next.set(
			'variant',
			variants[(index + variants.length) % variants.length]!.key,
		)
		setSearchParams(next, { replace: true })
	}

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return
			}
			if (event.key === 'ArrowLeft') {
				event.preventDefault()
				select(currentIndex - 1)
			}
			if (event.key === 'ArrowRight') {
				event.preventDefault()
				select(currentIndex + 1)
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	})

	const variant = variants[currentIndex]!
	return (
		<div className="fixed right-1/2 bottom-20 z-50 flex translate-x-1/2 items-center gap-1 rounded-full bg-neutral-950 p-1 text-white shadow-xl md:bottom-4">
			<button
				type="button"
				className="flex size-10 items-center justify-center rounded-full hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-hidden"
				aria-label="Previous prototype"
				onClick={() => select(currentIndex - 1)}
			>
				<span aria-hidden="true">←</span>
			</button>
			<div className="min-w-44 px-2 text-center text-xs">
				<p className="font-medium">
					{variant.key} — {variant.label}
				</p>
				<p className="text-white/60">Prototype · changes are local</p>
			</div>
			<button
				type="button"
				className="flex size-10 items-center justify-center rounded-full hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-hidden"
				aria-label="Next prototype"
				onClick={() => select(currentIndex + 1)}
			>
				<span aria-hidden="true">→</span>
			</button>
		</div>
	)
}
