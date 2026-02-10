import { Img } from 'openimg/react'
import { useRef } from 'react'
import { Link, Form } from 'react-router'
import { getUserImgSrc } from '#app/utils/misc.tsx'
import { useUser } from '#app/utils/user.ts'
import { Button } from './ui/button'
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuPortal,
	DropdownMenuContent,
	DropdownMenuItem,
} from './ui/dropdown-menu'
import { Icon } from './ui/icon'

export function UserDropdown() {
	const user = useUser()
	const formRef = useRef<HTMLFormElement>(null)
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button asChild variant="ghost">
					<Link
						to="/settings/profile"
						// this is for progressive enhancement
						onClick={(e) => e.preventDefault()}
						className="bg-card hover:bg-muted/50 flex items-center gap-2 rounded-full border border-border/50 shadow-warm"
						aria-label="User menu"
					>
						<Img
							className="ring-accent/20 size-8 rounded-full object-cover ring-2"
							alt={user.name ?? user.username}
							src={getUserImgSrc(user.image?.objectKey)}
							width={256}
							height={256}
							aria-hidden="true"
						/>
						<span className="text-body-sm font-bold">
							{user.name ?? user.username}
						</span>
					</Link>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuContent sideOffset={8} align="end">
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/settings/profile">
							<Icon className="text-body-md" name="avatar">
								Profile
							</Icon>
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link prefetch="intent" to="/recipes">
							<Icon className="text-body-md" name="pencil-2">
								My Recipes
							</Icon>
						</Link>
					</DropdownMenuItem>
					<Form action="/logout" method="POST" ref={formRef}>
						<DropdownMenuItem asChild>
							<button type="submit" className="w-full">
								<Icon className="text-body-md" name="exit">
									Logout
								</Icon>
							</button>
						</DropdownMenuItem>
					</Form>
				</DropdownMenuContent>
			</DropdownMenuPortal>
		</DropdownMenu>
	)
}
