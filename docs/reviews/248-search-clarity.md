# Try the search fix

Open http://localhost:9248/recipes?favorites=true&search=Walnut. Sign in with
**searchreview** / **local-search-248**.

**Your task: find Walnut pasta.**

1. Notice that **Favorites** is limiting the results.
2. Choose **Clear search and filters**.
3. Walnut pasta should appear and open normally.

Tell me if that was clear or confusing. No side-by-side comparison is needed.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-248
sh /private/tmp/qm-248-review/start.sh
```

[Other checks, setup and evidence](248-search-evidence.md) are recorded
separately. Alex approved opening
[PR #265](https://github.com/the-artifabrian/quartermaster/pull/265) after local
review. Merge/deployment still requires separate approval.
