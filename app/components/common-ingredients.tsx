import { Form } from 'react-router'
import { COMMON_INGREDIENTS } from '#app/utils/inventory-validation.ts'
import { Button } from './ui/button.tsx'
import { Icon } from './ui/icon.tsx'

type CommonIngredientsProps = {
	location: 'pantry' | 'fridge' | 'freezer'
}

export function CommonIngredients({ location }: CommonIngredientsProps) {
	return (
		<div className="space-y-3">
			<h3 className="text-muted-foreground text-sm font-medium">
				Common Ingredients
			</h3>
			<div className="flex flex-wrap gap-2">
				{COMMON_INGREDIENTS.map((ingredient) => (
					<Form key={ingredient} method="POST">
						<input type="hidden" name="intent" value="create" />
						<input type="hidden" name="location" value={location} />
						<input type="hidden" name="name" value={ingredient} />
						<Button
							type="submit"
							variant="outline"
							size="sm"
							className="text-xs"
						>
							<Icon name="plus" size="xs" />
							{ingredient}
						</Button>
					</Form>
				))}
			</div>
		</div>
	)
}
