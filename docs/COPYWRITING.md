# Copy guide

Write like a person trying to get dinner sorted. Be calm, concrete, and brief.

## Product terms

Use the terms in [GLOSSARY.md](../GLOSSARY.md). In user-facing copy:

- **Recipe**: ingredients and instructions for one thing.
- **Menu**: a reusable group of Recipes and notes served together.
- **Meal**: one scheduled item in the Plan.
- **Staples**: household ingredients normally assumed available, kept as a
  quick-add list. Tapping one adds it to Next shop.
- **Plan**: the household's week-by-week schedule of Meals. Not “Meal Plan.”
- **Shopping**: the household's one list, and the name of its tab. Not “Shopping
  List” or “Shop.” Its two horizons are **Next shop** and **Later**.
- **Household**: the people who share one set of Recipes, Menus, Plan, Staples,
  and Shopping.

Capitalise these terms in copy. Repeat the right term instead of inventing
synonyms such as kitchen memory, stock, inventory, pantry, or meal slot. Staples
have no Out or Available state; do not describe one.

## Action names

Each action has one name wherever it is offered:

- **Add to Plan** puts a Recipe or Menu on a day from its own page. **Add Meal**
  adds one from the Plan page.
- **Add to Shopping** puts a Meal, an ingredient, or an item on Shopping.
  **Update Shopping** refreshes a Meal already there. A Staple's row says
  **Need** (then “On list”): the row is short, and the page is only about
  Shopping.
- **New Recipe** makes a Recipe, by **Import** or **Write a Recipe**.
- **Share** shares a Recipe or Menu.
- **Log in** and **Log out**.
- **Mark cooked** and **Mark not cooked** set a Meal's state.

A menu item drops the noun its menu is already about: “Edit” and “Delete” in a
Shopping item's menu, “Print” in a Recipe's. Keep the noun where nothing around
the label supplies it: sheet titles, confirm buttons (“Delete Recipe”), and the
names of icon-only buttons.

A delete that can be undone happens at once and says what went, with Undo:
“Deleted milk”, “Cleared 3 checked items”, “Deleted Soup”. One that cannot opens
a confirm sheet: the action as a question (“Delete this Recipe?”, “Leave this
Household?”), one line on what is lost, a red button that names the action
(“Delete Recipe”) and Cancel. Do not use a browser confirm dialog or “Are you
sure?”. Leaving an edit screen with changes asks “Discard changes?”, says what
is not saved, and offers **Discard Changes** and **Keep Editing**.

A form error sits next to what it is about and says what to do there: “Name this
ingredient, or remove it”, “Write this step, or remove it”.

In the iOS app, copy never points at Pro (ADR 0001). A Pro-only action there
says it is not available on the account and names the free way instead:
“Screenshot import isn’t available on your account. Paste the Recipe’s link or
text instead.”

## Rules

- Tell the user what happened or what they can do next.
- Prefer a concrete claim over a benefit slogan.
- Keep one idea per sentence.
- Cut explanations the interface already makes obvious.
- Name errors in the user’s language and offer the next action when possible.
- Do not imply exact stock, cookability, timing, yield, or cost when the app has
  partial information.
- Use sentence case. Use bold, headings, tables, and em dashes only when they
  make scanning easier.

Avoid words such as “robust,” “seamless,” “powerful,” “comprehensive,”
“transform,” “elevate,” and “unlock.” Also avoid forced three-part slogans and
“not just X, but Y.”

## Examples

Instead of:

> Build a robust inventory that empowers smarter cooking decisions.

Write:

> Add the Staples you usually have.

Instead of:

> Streamline your shopping workflow with a comprehensive generated list.

Write:

> Generate Shopping from this week’s Meals.

Instead of:

> Take control of your week with intentional meal planning.

Write:

> Pick what you want to cook this week.

Instead of:

> Harness AI to transform scattered recipes into a seamless digital cookbook.

Write:

> Paste a Recipe. Quartermaster will pull out the ingredients and steps.

Instead of:

> No recipes yet. Start your culinary journey.

Write:

> No Recipes yet. Add one you already cook.

## Quick check

Before shipping copy, ask:

- Could this line be shorter?
- Does it help with the current task?
- Could any app say it?
- Does it promise more certainty than we have?
- Does it sound natural on a Tuesday night?

Useful defaults: “Add a Recipe,” “Plan a Meal,” “Add to Next shop,” “Try again,”
and “Nothing changed.”
