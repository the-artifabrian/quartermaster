# Try cooking reset

Open http://localhost:9237/recipes/cooking-review-pasta. Sign in with
**cookingreview** / **local-cooking-237**.

**Your task: clear the checks for another cook.**

Check pasta and the first instruction. Reload, then choose **More actions (…) →
Reset cooking checks**.

**Expected:** the checks survive reload, then both clear when you reset.

Tell me whether this works as expected and whether I may open the PR.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-237
sh /private/tmp/qm-237-review/start.sh
```

[Technical evidence and setup](237-cooking-evidence.md) are separate. PR opening
awaits explicit approval under [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md).
Merge and deployment require separate approval.
