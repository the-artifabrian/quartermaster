import { useInputControl } from '@conform-to/react'
import { REGEXP_ONLY_DIGITS_AND_CHARS, type OTPInputProps } from 'input-otp'
import React, { useEffect, useId, useRef } from 'react'
import { Checkbox, type CheckboxProps } from './ui/checkbox.tsx'
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from './ui/input-otp.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'
import { Textarea } from './ui/textarea.tsx'

export type ListOfErrors = Array<string | null | undefined> | null | undefined

export function ErrorList({
	id,
	errors,
	focusable = false,
}: {
	errors?: ListOfErrors
	id?: string
	/** A list's own error, with no field to focus: a failed Save focuses
	 * the message itself (focusFirstError). */
	focusable?: boolean
}) {
	const errorsToRender = errors?.filter(Boolean)
	if (!errorsToRender?.length) return null
	return (
		<ul
			id={id}
			tabIndex={focusable ? -1 : undefined}
			data-error-target={focusable ? '' : undefined}
			className="flex flex-col gap-1 outline-none"
		>
			{errorsToRender.map((e) => (
				<li key={e} className="text-foreground-destructive text-xs">
					{e}
				</li>
			))}
		</ul>
	)
}

/**
 * A row error offers to remove the row ("Name this ingredient, or remove
 * it"); the only row cannot be removed, so it says just what to do.
 */
export function withoutRemoveOffer(message: string) {
	return message.replace(/, or remove it$/, '')
}

const ERROR_TARGETS =
	'[aria-invalid="true"]:not([type="hidden"]), [data-error-target]'

/**
 * Brings the form's first error into view and focuses it: its field, or a
 * list's own message. Collapsed sections around it open first. It lands mid
 * screen, clear of the pinned nav bar. False when no error is on screen yet.
 */
export function focusFirstError(form: HTMLElement | null) {
	const target = form?.querySelector<HTMLElement>(ERROR_TARGETS)
	if (!target) return false
	for (
		let details = target.closest('details');
		details;
		details = details.parentElement?.closest('details') ?? null
	) {
		details.open = true
	}
	target.focus({ preventScroll: true })
	// Optional: jsdom has none.
	target.scrollIntoView?.({ block: 'center' })
	return true
}

function hasErrors(result: unknown) {
	if (typeof result !== 'object' || result === null) return false
	const error = (result as { error?: Record<string, unknown> | null }).error
	return Object.values(error ?? {}).some(
		(errors) => Array.isArray(errors) && errors.length > 0,
	)
}

/**
 * After a failed Save, the first error comes into view and takes focus
 * (focusFirstError): on the action's reply (`lastResult`) and when the
 * returned function is called (a failed client validation). Revalidating a
 * field on blur does neither, so it never moves focus.
 */
export function useFocusErrorOnFailedSave(formId: string, lastResult: unknown) {
	const pending = useRef(false)
	useEffect(() => {
		if (hasErrors(lastResult)) pending.current = true
	}, [lastResult])
	// Every render: the errors show a render after the Save that found them.
	useEffect(() => {
		if (!pending.current) return
		if (focusFirstError(document.getElementById(formId))) {
			pending.current = false
			return
		}
		const frame = requestAnimationFrame(() => {
			pending.current = false
			focusFirstError(document.getElementById(formId))
		})
		return () => cancelAnimationFrame(frame)
	})
	return () => {
		pending.current = true
		// The same errors as last time render nothing new.
		requestAnimationFrame(() => {
			if (!pending.current) return
			pending.current = false
			focusFirstError(document.getElementById(formId))
		})
	}
}

export function Field({
	labelProps,
	inputProps,
	errors,
	className,
}: {
	labelProps: React.LabelHTMLAttributes<HTMLLabelElement>
	inputProps: React.InputHTMLAttributes<HTMLInputElement>
	errors?: ListOfErrors
	className?: string
}) {
	const fallbackId = useId()
	const id = inputProps.id ?? fallbackId
	const errorId = errors?.length ? `${id}-error` : undefined
	return (
		<div className={className}>
			<Label htmlFor={id} {...labelProps} />
			<Input
				id={id}
				aria-invalid={errorId ? true : undefined}
				aria-describedby={errorId}
				{...inputProps}
			/>
			{errorId ? (
				<div className="px-4 pt-1 pb-3">
					<ErrorList id={errorId} errors={errors} />
				</div>
			) : null}
		</div>
	)
}

export function OTPField({
	labelProps,
	inputProps,
	errors,
	className,
}: {
	labelProps: React.LabelHTMLAttributes<HTMLLabelElement>
	inputProps: Partial<OTPInputProps & { render: never }>
	errors?: ListOfErrors
	className?: string
}) {
	const fallbackId = useId()
	const id = inputProps.id ?? fallbackId
	const errorId = errors?.length ? `${id}-error` : undefined
	return (
		<div className={className}>
			<Label htmlFor={id} {...labelProps} />
			<InputOTP
				pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
				maxLength={6}
				id={id}
				aria-invalid={errorId ? true : undefined}
				aria-describedby={errorId}
				{...inputProps}
			>
				<InputOTPGroup>
					<InputOTPSlot index={0} />
					<InputOTPSlot index={1} />
					<InputOTPSlot index={2} />
				</InputOTPGroup>
				<InputOTPSeparator />
				<InputOTPGroup>
					<InputOTPSlot index={3} />
					<InputOTPSlot index={4} />
					<InputOTPSlot index={5} />
				</InputOTPGroup>
			</InputOTP>
			<div className="min-h-[32px] px-4 pt-1 pb-3">
				{errorId ? <ErrorList id={errorId} errors={errors} /> : null}
			</div>
		</div>
	)
}

export function TextareaField({
	labelProps,
	textareaProps,
	errors,
	className,
}: {
	labelProps: React.LabelHTMLAttributes<HTMLLabelElement>
	textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>
	errors?: ListOfErrors
	className?: string
}) {
	const fallbackId = useId()
	const id = textareaProps.id ?? textareaProps.name ?? fallbackId
	const errorId = errors?.length ? `${id}-error` : undefined
	return (
		<div className={className}>
			<Label htmlFor={id} {...labelProps} />
			<Textarea
				id={id}
				aria-invalid={errorId ? true : undefined}
				aria-describedby={errorId}
				{...textareaProps}
			/>
			{errorId ? (
				<div className="px-4 pt-1 pb-3">
					<ErrorList id={errorId} errors={errors} />
				</div>
			) : null}
		</div>
	)
}

export function CheckboxField({
	labelProps,
	buttonProps,
	errors,
	className,
}: {
	labelProps: React.ComponentProps<'label'>
	buttonProps: CheckboxProps & {
		name: string
		form: string
		value?: string
	}
	errors?: ListOfErrors
	className?: string
}) {
	const { key, defaultChecked, ...checkboxProps } = buttonProps
	const fallbackId = useId()
	const checkedValue = buttonProps.value ?? 'on'
	const input = useInputControl({
		key,
		name: buttonProps.name,
		formId: buttonProps.form,
		initialValue: defaultChecked ? checkedValue : undefined,
	})
	const id = buttonProps.id ?? fallbackId
	const errorId = errors?.length ? `${id}-error` : undefined

	return (
		<div className={className}>
			<div className="flex gap-2">
				<Checkbox
					{...checkboxProps}
					id={id}
					aria-invalid={errorId ? true : undefined}
					aria-describedby={errorId}
					checked={input.value === checkedValue}
					onCheckedChange={(state) => {
						input.change(state.valueOf() ? checkedValue : '')
						buttonProps.onCheckedChange?.(state)
					}}
					onFocus={(event) => {
						input.focus()
						buttonProps.onFocus?.(event)
					}}
					onBlur={(event) => {
						input.blur()
						buttonProps.onBlur?.(event)
					}}
					type="button"
				/>
				<label
					htmlFor={id}
					{...labelProps}
					className="text-muted-foreground self-center text-sm"
				/>
			</div>
			<div className="px-4 pt-1 pb-3">
				{errorId ? <ErrorList id={errorId} errors={errors} /> : null}
			</div>
		</div>
	)
}
