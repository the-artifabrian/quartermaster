# #252 research notes

The simple preview is the default. Use `?details=1&variant=B&kitchen=none` for
the full experiment below. These are retained research notes, not a testing
checklist.

## What is held equal

Saturday supper contains Chickpea salad 1×, Lemon rice 2×, Rice-stuffed peppers
1× and Yogurt dip 0.5×, plus a Serve cold note with 2 bottles sparkling water
and an unresolved ice purchase. Rice combines 400 g + 0.2 kg into 600 g; garlic
combines 4 + 1 cloves. Normal olive oil is omitted; garlic is Out. Existing Next
shop contains another member's 1 l milk unchecked and 2 cloves garlic checked.
Herbs “handful, to taste” and ice stay unresolved. The simple case uses only
Chickpea salad 1×, without planning.

The harness uses the application's typography, buttons, flat rows and shell. The
experiment controls, evidence and #242 panels are research controls, not
proposed product panels. Navigation timing, actual kitchen trips, SSE and
provider behavior are not simulated. The proposed Recipe bulk shortcut and
correction/new-demand repairs are explicitly labelled.

| Variant | Purpose                                                                         | Limits                                                                                                                              |
| ------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A       | Open dishes and use individual carts; note purchases represent manual additions | Existing names are skipped, matching the current Recipe action boundary; note-entry detail and normal UI navigation are abbreviated |
| B       | Combined Meal transfer followed by ordinary Shopping correction                 | Fixture reproduction of current contribution behavior; use the actual app below for uninterrupted baseline effort                   |
| C       | Combined transfer with simulated safe new demand and total correction           | Equivalent control: the same aggregation, bulk transfer and correction capability as D, without review                              |
| D       | Same capability, plus one optional Check ingredients first path                 | This is the review hypothesis; direct Add to Shopping stays available                                                               |

A → B illustrates aggregation and transfer differences. B → C illustrates
simulated correctness fixes and, for direct Recipe scope, a proposed shortcut.
**Only C → D isolates the added value and cost of review.** Do not credit review
for an arithmetic repair or fewer carts that it does not require.

## Tasks

1. **No correction, one Recipe:** select Single Recipe and No corrections. In C,
   Add to Shopping. In D, Check ingredients first, inspect and Add to Shopping.
   Both add 400 g chickpeas and 1 lemon, preserve milk and handled garlic, and
   omit olive oil. D pays for opening and reading review. Its direct Add path
   remains usable. Try the same with the four-dish Meal.
2. **Enough chickpeas:** select the Meal and Enough chickpeas. Open dishes in A
   and check the kitchen as needed; compare B, C and D. In D set Buy chickpeas
   to 0; in C transfer, Edit chickpeas and Remove this purchase. Chickpeas do
   not become a Staple. Expected final list: other requirements plus existing
   purchases, with no chickpea purchase for this cook.
3. **Partial rice:** select the Meal and Enough chickpeas + 500 g rice. In D,
   review, set chickpeas to 0 and rice to 100, then transfer. In C, transfer,
   remove chickpeas and edit rice to 100. Both reach the same new purchases;
   compare revisits, kitchen checks, correction steps and rereading. Garlic's
   existing checked 2 cloves must not pay for the new 5 cloves in either
   control.
4. **Current correction caveat:** in B, transfer, edit rice from 600 to 100,
   return to Meal and explicitly request the source again. It shows 700 g. This
   is the observed current defect; the first edit alone correctly shows 100 g. B
   also illustrates new garlic demand joining the checked row. These defects
   belong to settled reliability/gated purchase work, not proof that D deserves
   a new screen.
5. Expand Experiment evidence to compare intended amounts and the action log.
   Input events are not a standardized tap score. Count actual Recipe revisits,
   kitchen trips, repeated entry, corrections, missed purchases and reading work
   yourself. A missing transfer or skipped purchase is not a successful faster
   run. The log is implementation evidence, not measured household effort.
6. Compare all #242 cases using Show both outcomes, then switch planned-Recipe
   placement: whole-Meal action on the Recipe versus Open Saturday supper and
   act at the Meal. Lemon rice shows viewing 3× while its planned scale stays
   2×; whole-Meal transfer includes the other dishes and notes, and return keeps
   the 3× view. No scope picker or direct extra cook is introduced in that
   fragment.

## Actual current-app baseline

Use another tab at http://localhost:9252/plan. The runner seeds Saturday supper
in the current week with a genuine Menu snapshot. Open its Meal actions → **Add
to Shopping List**, then Shop. Open the Recipe links to compare actual
individual ingredient carts. Use My Menus to inspect the reusable Menu too.

For an identical fresh Shopping baseline before each real-app run:

```sh
cd /private/tmp/quartermaster-252
bun scripts/prototypes/252-reset-shopping.ts
```

Reload Plan and Shop. This command checks the named synthetic account/household
and resets only its Shopping rows (including their generated contributions). The
comparison harness resets independently by changing a variant/fixture.

Observed in the real local app: rice totals 600 g; garlic shows 7 cloves checked
including the Meal's new 5 cloves; milk stays 1 l; olive oil is omitted; herbs
and ice remain unresolved. Editing rice to 100 g shows 100 g; explicitly
refreshing the Meal then shows 700 g. This agrees with the corrected B fixture.
The current mobile and desktop Plan/Shopping presentation is unchanged.

## #242 assumptions and unanswered decisions

The five example groups cover all six owning-issue questions: total correction,
legacy overlap, retry versus another cook, direct shopping then planning,
handled quantities/change/clear, and planned-Recipe action placement. Unknown
amounts, incompatible units and another member's manual purchases stay explicit.

The completion candidate preserves #227's current-source 200 g baseline through
a temporary decrease: re-increasing to 600 g leaves 400 g outstanding. Clearing
checked 200 g while 400 g remains retains that baseline; removing all source
demand ends it. Do not confuse clearing some checked rows with retiring all
purchase intent. The proposed correction offset and direct-cook identity are
additional undecided choices, not accepted #227 rules.

The alternative uses bounded snapshots plus explicit overlap/correction choices;
retirement can require a fresh kitchen check. Neither model can infer whether
identical Recipe requests mean a retry or another dinner, or whether a checked
purchase is still available. The visible examples must be accepted before
rewriting #227/#228/#230. No implementation or readiness change to those tickets
follows from this prototype.

## Recommendation, evidence and limits

Provisional recommendation: keep the direct path and prefer fixing accepted
underlying purchase behavior. The no-correction case gives review no advantage.
Keep or narrow D only if a normal multi-dish preparation shows less total work
than C; stop it if ordinary Shopping corrections are clearer. This is an agent
recommendation, not Alex's decision or household-use evidence.

TypeScript/lint and formatting/diff review pass (four existing unrelated lint
warnings). Scratch Chromium journeys exercised partial corrections, preserved
manual/handled purchases, placement/return, all variants on phone/desktop, and
real Plan → Shopping → correction → explicit refresh. Scoped prototype fixes
made selectors fit phone width, kept the floating switcher from covering final
controls, and aligned B's correction sequence with the actual app. No browser
page errors or horizontal overflow in the checked variants. Synthetic
screenshots are under `/private/tmp/qm-roadmap-20260905/252-*.png`.

No automated prototype test suite was added. This abbreviated in-memory fixture
is not a backend, persistence or physical-device implementation. A review
omission affects this one transfer/intended cook only; C/D repeat-use behavior
is deliberately not a production contract. Use the labelled #242 examples for
lifetime decisions. The actual app baseline remains available to assess the
navigation and correction work omitted by the harness.

Leave #252 open and ready-for-human for keep/simplify/stop. A prototype PR and
any production integration require explicit approval; merging/deployment always
require separate approval.
