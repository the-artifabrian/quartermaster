import * as LabelPrimitive from '@radix-ui/react-label'
import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '#app/utils/misc.tsx'

// On a phone a field's label is the small label, muted, on a line of its own
// above the field. Wider screens keep the 14px label.
const labelVariants = cva(
	'phone:text-label phone:text-muted-foreground phone:mb-1.5 phone:block phone:leading-(--text-label--line-height) phone:font-semibold text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
)

const Label = ({
	className,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) => (
	<LabelPrimitive.Root
		data-slot="label"
		className={cn(labelVariants(), className)}
		{...props}
	/>
)

export { Label }
