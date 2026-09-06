# Try cooking reset

Open http://localhost:9237/recipes/cooking-review-pasta. Sign in with
**cookingreview** / **local-cooking-237**.

**Your task: clear the checks for another cook.**

Check pasta and the first instruction. Reload, then choose **More actions (…) →
Reset cooking checks**.

**Expected:** the checks survive reload, then both clear when you reset.

Alex tried this preview, confirmed it works, and explicitly approved opening the
PR.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-237
sh /private/tmp/qm-237-review/start.sh
```

[Technical evidence and setup](237-cooking-evidence.md) are separate. The
PR-opening requirement in [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) is
satisfied. Merge and deployment require separate approval.
