import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'
import { buttonVariants } from './button.tsx'

function AlertDialog(
	props: React.ComponentProps<typeof AlertDialogPrimitive.Root>,
) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(
	props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>,
) {
	return (
		<AlertDialogPrimitive.Trigger
			data-slot="alert-dialog-trigger"
			{...props}
		/>
	)
}

function AlertDialogPortal(
	props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>,
) {
	return (
		<AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
	)
}

const AlertDialogOverlay = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) => (
	<AlertDialogPrimitive.Overlay
		data-slot="alert-dialog-overlay"
		className={cn(
			'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
			className,
		)}
		{...props}
	/>
)

const AlertDialogContent = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) => (
	<AlertDialogPortal>
		<AlertDialogOverlay />
		<AlertDialogPrimitive.Content
			data-slot="alert-dialog-content"
			className={cn(
				'bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg duration-200',
				className,
			)}
			{...props}
		/>
	</AlertDialogPortal>
)

const AlertDialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		data-slot="alert-dialog-header"
		className={cn('flex flex-col gap-2', className)}
		{...props}
	/>
)

const AlertDialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		data-slot="alert-dialog-footer"
		className={cn('flex justify-end gap-2', className)}
		{...props}
	/>
)

const AlertDialogTitle = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => (
	<AlertDialogPrimitive.Title
		data-slot="alert-dialog-title"
		className={cn('text-lg font-semibold', className)}
		{...props}
	/>
)

const AlertDialogDescription = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => (
	<AlertDialogPrimitive.Description
		data-slot="alert-dialog-description"
		className={cn('text-muted-foreground text-sm', className)}
		{...props}
	/>
)

const AlertDialogAction = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) => (
	<AlertDialogPrimitive.Action
		className={cn(buttonVariants(), className)}
		{...props}
	/>
)

const AlertDialogCancel = ({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) => (
	<AlertDialogPrimitive.Cancel
		className={cn(buttonVariants({ variant: 'outline' }), className)}
		{...props}
	/>
)

export {
	AlertDialog,
	AlertDialogPortal,
	AlertDialogOverlay,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
}
