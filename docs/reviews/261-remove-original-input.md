# #261 local review

Branch `fix/261-remove-original-input`, from merged #260 (`be833bd`). This is
the agreed removal of Original input from optional import editing and saved
Recipe Edit. The overview, optional Edit/Done editing, Import Another, Save
Recipe and useful Source URL fields are preserved. No new controls or state.

## Run

The prepared disposable production build runs at http://localhost:9261. Sign in
with **importreview** / **local-import-233**. If stopped:

```sh
cd /private/tmp/quartermaster-261
sh /private/tmp/qm-261-review/start.sh
```

To rebuild after a local change, stop this server, run `bun run build`, then
restart it. The script selects `/private/tmp/qm-261-review/data.db`, port 9261,
mocks and synthetic providers. This is separate from the historical #233 server
on port 9233, which still demonstrates the merged baseline.

The prepared scratch database was created with `prisma migrate deploy` and
`/private/tmp/qm-261-review/seed.ts`; providers and the synthetic image are in
that same scratch directory. Nothing uses household or production records.

## Try

1. From URL, use `https://recipes.example.test/chickpeas`. From Text, paste a
   synthetic Recipe and use Parse Recipe or Extract with AI. From Image, upload
   `/private/tmp/qm-261-review/recipe.png`. URL and AI results are provider
   mocks.
2. Each result opens the existing overview. Save directly, or choose Edit,
   correct title/ingredients/steps, and return with Done editing. Original input
   and raw extraction JSON are absent throughout. Source URL remains editable.
3. Save, reopen the Recipe and open Edit. Source URL remains useful; no Original
   input disclosure appears. Edit and save normally.
4. Check `/resources/export-recipes` and `/resources/export-all-data` while
   signed in. Retained `rawText` remains; pasted text keeps its original
   content, URL/image imports keep available extracted structure. This is
   recovery data, not a webpage or image archive.
5. Try phone and desktop widths. An invalid title or failed save retains the
   current corrections. Import Another still requires deliberate discard.

## Evidence and review

- 23 affected Vitest tests pass across import/source/recovery/sharing, AI Recipe
  paths and ordinary Recipe actions. Supported export/restore and older-format
  compatibility remain covered by the existing source-preservation tests.
- Production build, TypeScript, lint and formatting/diff checks pass; four
  unrelated existing lint warnings remain.
- Three production-build Chromium journeys pass: import correction with
  validation/connection failure and one confirmed save, direct overview save and
  incomplete extraction, and ordinary Recipe CRUD.
- Six additional synthetic provider journeys pass: URL/text/image at 390px and
  1280px, optional correction, overview, save/reload, saved Edit and exact
  retained source in authenticated export. No disclosure or preformatted source
  appears; no browser page errors. Source URL remains intact.
- Complete diff reviewed: only two rendered blocks and the now-unused saved
  editor loader selection removed; the hidden active-review `rawText` field,
  writes, persistence, exports and authenticated sharing are unchanged.
- Phone/desktop import/saved-editor screenshots inspected in
  `/private/tmp/qm-261-review/`. The existing editor schedules focus on Edit;
  the scratch automation waits for that focus before typing.

This straightforward removal can proceed to PR under Alex's exception. Merging
or deployment still requires separate approval. #257, the broad mobile Staples
assertion in #223 and physical-device status-bar diagnosis #262 remain separate.
