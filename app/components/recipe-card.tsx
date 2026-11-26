import { Img } from 'openimg/react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { useViewTransitionState } from 'react-router'
import { PushLink } from './push-link.tsx'
import { formatDuration } from '#app/utils/format-duration.ts'
import { IMG_SIZES } from '#app/utils/image-route.ts'
import { cn } from '#app/utils/misc.tsx'
import { getRecipePlaceholder } from '#app/utils/recipe-placeholder.ts'
import { Icon } from './ui/icon.tsx'

type RecipeCardProps = {
	id: string
	title: string
	description?: string | null
	imageObjectKey?: string | null
	totalTime?: number | null
	showUnknownTime?: boolean
	isFavorite?: boolean
}

export function RecipeCard({
	id,
	title,
	description,
	imageObjectKey,
	totalTime,
	showUnknownTime = false,
	isFavorite,
}: RecipeCardProps) {
	const placeholder = !imageObjectKey ? getRecipePlaceholder(title) : null
	const to = `/recipes/${id}`
	// True while this card's Recipe page slides in or out; the image moves
	// between the card and the page.
	const isTransitioning = useViewTransitionState(to)
	const nameRef = useRef<HTMLSpanElement>(null)
	const heartClipped = useClipped(nameRef, Boolean(isFavorite))
	const phoneTime =
		totalTime != null
			? formatDuration(totalTime)
			: showUnknownTime
				? 'Time unknown'
				: null

	return (
		<PushLink
			to={to}
			// Outside the iOS app too: a cross-fade.
			viewTransition
			// On a phone a row: the name, the time and description under it, the
			// photo at the right. Wider, a card with the image on top.
			className="group active:bg-muted/40 md:border-border/60 md:bg-card md:text-card-foreground md:hover:border-primary/30 md:active:bg-card flex flex-row items-center gap-3.5 px-4 py-2.5 transition-colors max-md:min-h-[73px] sm:px-8 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-md md:border md:p-0 md:transition-colors md:duration-[180ms] md:ease-[var(--ease-hover-lift)]"
		>
			<div
				data-recipe-image-transition={
					isTransitioning && imageObjectKey ? '' : undefined
				}
				className={cn(
					'relative shrink-0 overflow-hidden rounded-md max-md:order-last md:rounded-none',
					imageObjectKey
						? 'size-[52px] md:aspect-[4/3] md:h-auto md:w-full'
						: // No letter tile on a phone: the row ends with its text.
							'flex size-[52px] max-md:hidden md:h-28 md:w-full',
				)}
			>
				<div className="absolute top-2 right-2 z-10 hidden items-center gap-1 md:flex">
					{isFavorite && (
						<Icon
							name="heart-filled"
							className="size-4 text-white drop-shadow"
						/>
					)}
				</div>
				{imageObjectKey ? (
					<Img
						src={`/resources/images?objectKey=${encodeURIComponent(imageObjectKey)}`}
						alt={title}
						className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
						{...IMG_SIZES.card}
					/>
				) : (
					<div
						role="img"
						aria-label={`${title} recipe`}
						className={cn(
							'flex h-full w-full items-center justify-center',
							placeholder!.bgClass,
						)}
					>
						<span
							className={cn(
								'font-serif text-2xl md:text-4xl',
								placeholder!.letterColorClass,
							)}
						>
							{placeholder!.letter}
						</span>
					</div>
				)}
			</div>

			<div
				className={cn(
					'flex min-w-0 flex-1 flex-col justify-center md:justify-start',
					imageObjectKey ? 'md:p-5' : 'md:p-6',
				)}
			>
				<div className="flex items-center gap-1.5">
					<h3
						className={cn(
							'text-list-name min-w-0 font-serif md:text-base md:leading-[1.3] md:tracking-[-0.005em]',
							heartClipped && 'max-md:flex',
						)}
					>
						<span ref={nameRef} className="line-clamp-3 md:line-clamp-2">
							{title}
							{isFavorite && (
								// On a phone the heart follows the name, and says so to a
								// screen reader. A name cut at three lines cuts it off
								// too, so a second one then ends the third line.
								<span className="md:hidden">
									<Icon
										name="heart-filled"
										data-favorite=""
										className="text-primary ml-2 inline-block size-3.5 align-baseline"
									/>
									<span className="sr-only"> Favorite</span>
								</span>
							)}
						</span>
						{heartClipped ? (
							<Icon
								name="heart-filled"
								data-favorite="end"
								className="text-primary mb-1.5 ml-1 size-3.5 shrink-0 self-end md:hidden"
							/>
						) : null}
					</h3>
				</div>

				{phoneTime || description ? (
					<p
						data-recipe-meta=""
						className="text-muted-foreground mt-[3px] flex min-w-0 gap-2.5 text-[0.90625rem] leading-snug md:hidden"
					>
						{phoneTime ? (
							<span className="shrink-0 font-semibold">{phoneTime}</span>
						) : null}
						{description ? (
							<span className="min-w-0 truncate">{description}</span>
						) : null}
					</p>
				) : null}

				{description && (
					<p
						className={cn(
							'text-muted-foreground hidden md:mt-1 md:block md:text-sm',
							imageObjectKey ? 'md:line-clamp-2' : 'md:line-clamp-3',
						)}
					>
						{description}
					</p>
				)}

				<div className="mt-auto hidden items-center gap-3 pt-2 md:flex">
					{(totalTime != null || showUnknownTime) && (
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<Icon name="clock" size="xs" />
							{totalTime != null ? formatDuration(totalTime) : 'Time unknown'}
						</span>
					)}
				</div>
			</div>
		</PushLink>
	)
}

/**
 * Whether `ref`'s line clamp cuts off its text. The heart inside it stays in
 * place either way, so showing a second heart outside never changes the
 * answer.
 */
function useClipped(ref: RefObject<HTMLElement | null>, enabled: boolean) {
	const [clipped, setClipped] = useState(false)
	useEffect(() => {
		const element = ref.current
		if (!enabled || !element) return
		const check = () =>
			setClipped(element.scrollHeight > element.clientHeight + 1)
		const observer = new ResizeObserver(check)
		observer.observe(element)
		check()
		return () => observer.disconnect()
	}, [ref, enabled])
	return enabled && clipped
}

export function RecipeCardGrid({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				'max-md:divide-border/40 grid grid-cols-1 max-md:-mx-4 max-md:gap-0 max-md:divide-y sm:max-md:-mx-8 md:grid-cols-2 md:gap-4 lg:grid-cols-3',
				className,
			)}
		>
			{children}
		</div>
	)
}
