# Try Recipe entry

Open http://localhost:9232/recipes/new. Sign in with **entryreview** /
**local-entry-232**.

**Your task: save a simple pasta Recipe.**

Enter **Simple pasta** as the title, **pasta** as the ingredient, and **Boil and
serve** as the first instruction. Choose **Create Recipe**.

**Expected:** ingredients are immediately reachable, and the saved Recipe opens
without needing optional details.

Tell me whether entering it felt straightforward.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-232
sh /private/tmp/qm-232-review/start.sh
```

[Technical evidence and setup](232-entry-evidence.md) are separate. Alex tried
the preview and approved opening a PR on 6 September 2026. Merge/deployment
still needs separate approval.
