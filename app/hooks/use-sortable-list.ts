import {
	type Announcements,
	KeyboardSensor,
	MouseSensor,
	type UniqueIdentifier,
	TouchSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

/**
 * Sensors and screen-reader announcements for the recipe form's reorderable
 * lists (ingredients, steps).
 *
 * A finger picks a row up by holding its handle for a moment, so a swipe
 * that starts on a handle still scrolls the form. A mouse picks it up after a
 * short drag, and the keyboard with Space on the focused handle.
 *
 * Announcements name rows the way the form does ("step 2", "flour") and say
 * where a row is as a position, rather than dnd-kit's default of internal ids.
 */
export function useSortableList({
	ids,
	describe,
}: {
	/** The rows' ids, in order. */
	ids: UniqueIdentifier[]
	/** What a row is called, e.g. "step 2". */
	describe: (id: UniqueIdentifier) => string
}) {
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 250, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)
	const position = (id: UniqueIdentifier) =>
		`position ${ids.indexOf(id) + 1} of ${ids.length}`
	const announcements: Announcements = {
		onDragStart: ({ active }) =>
			`Picked up ${describe(active.id)}, at ${position(active.id)}.`,
		onDragOver: ({ active, over }) =>
			over
				? `${capitalize(describe(active.id))} is at ${position(over.id)}.`
				: `${capitalize(describe(active.id))} is outside the list.`,
		onDragEnd: ({ active, over }) =>
			over
				? `${capitalize(describe(active.id))} dropped at ${position(over.id)}.`
				: `${capitalize(describe(active.id))} dropped back in place.`,
		onDragCancel: ({ active }) =>
			`Reordering cancelled. ${capitalize(describe(active.id))} went back.`,
	}
	return { sensors, accessibility: { announcements } }
}

function capitalize(text: string) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}
