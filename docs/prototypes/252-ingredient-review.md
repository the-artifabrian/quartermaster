# Try the Shopping preview

Open http://localhost:9252/recipes/menus/prototype-review. Sign in with
**review252** / **local-review-252**.

**One task:** you already have the chickpeas and most of the rice. Make the list
contain **no chickpeas and only 100 g rice**.

1. Try **Adjust on Shopping**. Add to Shopping, then correct the list.
2. Try **Check before adding**. Make the corrections first, then add.

The preview tells you the next step and confirms when you are done. Tell me
which option felt easier. That is the only feedback needed now.

Both use sample data and simulate the same Shopping fixes. Neither is an
accepted production change. #252 and the separate #242 decision stay open.

If the preview is stopped:

```sh
cd /private/tmp/quartermaster-252
bun scripts/prototypes/252-start.ts
```

[Detailed fixtures, other comparisons and evidence](252-research-notes.md) are
available separately; you do not need them to try this preview.
