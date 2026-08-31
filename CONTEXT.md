# Quartermaster

Quartermaster helps one household choose, plan, shop for, and prepare food while
keeping reusable cooking knowledge distinct from scheduled events and current
shopping state.

## Cooking and planning

**Recipe**: One canonical set of ingredients and instructions for preparing
food.

**Menu**: A reusable household collection of ordered Recipe and note cards
intended to be served together. _Avoid_: Recipe Pack, Collection

**Meal**: One scheduled Plan entry containing Recipe items, a Menu snapshot, or
generic text. _Avoid_: Meal slot, Plan row

**Menu snapshot**: The stable copy of a Menu's structure, notes, display
identity, and quantities held by a planned Meal.

**Scale multiplier**: A positive factor applied to one Recipe's stored
ingredient batch when its yield is not known reliably. _Avoid_: Servings when
yield is unknown

**Target yield**: The intended output amount for a Recipe whose numeric yield
and yield label are explicitly known.

**Recipe classification**: Optional household vocabulary assigned to a Recipe
across Cuisine, Season, and Course. A Recipe may have several values in each
dimension and remains complete without any classification. _Avoid_: Tag,
category

**Cuisine**: A household's description of a Recipe's culinary tradition or
style.

**Season**: A household's description of when a Recipe is especially relevant;
Year-round means it is not tied to one season.

**Course**: A household's description of a Recipe's role in a Meal, such as Main
or Side.

## Shopping and availability

**Shopping demand**: The deterministic ingredient and note-line requirements
calculated from accepted Meal inputs before household availability or
current-list state is applied.

**Shopping contribution**: One Meal's current generated share of Shopping
demand, retained separately from manual Shopping rows. _Avoid_: Shopping event,
purchase history

**Staple**: A canonical household ingredient normally assumed available and
omitted from generated Shopping demand.

**Out**: The state of a Staple that should be included when a Recipe requires
it. _Avoid_: Running low, depleted quantity

## Assistance

**Estimate**: The latest transparent, approximate cost result calculated from
stored inputs with coverage, source, confidence, and unresolved data.

**Preparation task**: One editable item in an accepted Meal-owned preparation
checklist. _Avoid_: Assignment, staff task
