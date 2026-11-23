# Agent notes

Product terms live in [GLOSSARY.md](GLOSSARY.md). Test setup and mechanics live
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#testing).

## Browser support

Web features that are Baseline widely available need no fallback; anything newer
gets a feature check and a fallback.

## Testing

A test earns its place by catching a bug that nothing else catches. Pick the
layer by where that bug would show up:

- **Playwright** (`tests/e2e/`) is the default for a feature. Anything a user
  can see or do gets a flow through the real UI, and it asserts both what the
  user sees and the data that was saved. Playwright runs on every pull request.
- **Vitest**, next to the module, covers dense logic that a flow can't reach
  cheaply: parsing, unit and date math, household scoping and authorization,
  validation, and races.

### Failure list first

Before writing code that you will test in isolation, write down its failure
list: the concrete inputs, states, orderings, and permissions that could break
it. Write one Vitest test per entry on the list, and then write the code. Take
tests from the failure list, not from the finished implementation. A test
written afterwards restates the code, so it fails when the code changes, not
when the code breaks.

### Running Playwright locally

`scripts/e2e.sh` runs the suite on a production build, a throwaway database and
CI mode. Dev mode taps the page before it hydrates, and the dev database
collects test users.

```sh
PORT=3117 scripts/e2e.sh tests/e2e/<file>.test.ts
```

Extra arguments go to `playwright test`. `PORT` (default 3117) keeps the run off
a dev server on :3000. The script puts the database in WAL mode, as production
runs it, so the server and the tests' own writes contend the way they do there.
It builds on every run, so app changes are always in.

### Evidence

A Playwright run is the evidence for a feature. Report the command you ran and
its pass and fail counts. Every pull request uploads `playwright-report`, with
traces for retried tests, as the repeatable artifact.

### Flakes

An intermittent failure has a cause. Reproduce it with `--repeat-each=10` at
both `--workers=1` and `--workers=4`, since load-sensitive races and
speed-sensitive races show up under different settings. Fix the cause. Retries
are there for runner hiccups.
