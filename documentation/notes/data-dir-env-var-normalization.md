# Data directory: normalize `IDEP_DATABASE` vs `IDEP_DATA_DIR`

**Date:** 2026-05-28
**Status:** Spec — investigation required before the fix is finalized.
**Trigger:** the grep investigation below is the first work item. The
code change follows once the canonical name is chosen.

## How this finding happened

I'd been working through `electron/main.js` line by line with Claude
as a JS tutor and ran out of focus around line 373. I asked Claude to
do a broad AI overview scan from there to end-of-file for bloat, dead
branches, and non-standard idioms.

The data-directory setup block stood out because **two environment
variables are read as fallbacks for each other, then both are written
back to the R subprocess with the same value.**

That kind of "two names for one concept" usually means a rename that
left the old name in place for backward compat — and the question
"which name is canonical" was never resolved.

## What the current code does

`electron/main.js:373` reads:

```js
const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;
```

Then `electron/main.js:441-442` writes both to the R subprocess env:

```js
env: {
  ...
  IDEP_DATABASE: DATA_PARENT,
  IDEP_DATA_DIR: DATA_PARENT,
  ...
}
```

`CLAUDE.md` documents `IDEP_DATABASE` as the canonical R-side var:

> Uses environment variable `IDEP_DATABASE` or falls back to relative
> paths

`IDEP_DATA_DIR` is not mentioned in `CLAUDE.md`. It appears to have
been added later as a more descriptive name, with `IDEP_DATABASE`
retained as a backward-compat alias.

## Why change it

Two names for one concept is its own kind of cognitive bloat:

- A reader can't tell which is canonical without searching the rest
  of the codebase.
- A future contributor might rename one but not the other, creating
  a silent break.
- The R-side code may read only `IDEP_DATABASE`, only
  `IDEP_DATA_DIR`, or both — and nothing enforces that they stay in
  sync.
- Documentation drifts: `CLAUDE.md` mentions only `IDEP_DATABASE`.

This is not bloat in the dead-code sense — both paths are reachable
and currently work. But it's a small, real source of friction that
compounds if iDEP grows more env vars or more entry points.

## Investigation (required first)

Run before writing any code:

```bash
grep -rn "IDEP_DATABASE\|IDEP_DATA_DIR" R/ inst/ electron/ tests/ dev/ documentation/
```

The grep result determines the right fix:

- **R only reads `IDEP_DATABASE`** — `IDEP_DATA_DIR` is electron-only
  and can be renamed or removed cleanly. Go to Path B below.
- **R only reads `IDEP_DATA_DIR`** — `IDEP_DATABASE` is the legacy
  alias and can be dropped from main.js with a simple search/replace.
  Go to Path A below.
- **R reads both, or different files read different ones** — pick
  the canonical name (recommend `IDEP_DATA_DIR` for clarity), update
  R-side to match, keep the other as a documented backward-compat
  alias OR drop it entirely depending on whether external users have
  scripts setting it. Go to Path A with the alias-kept variant.
- **Neither shows up R-side** — both are dead, drop both entirely.

This investigation is cheap (one grep) but determines the entire
shape of the fix, so it must precede spec finalization.

## Proposed change (pending investigation)

### Path A — `IDEP_DATA_DIR` becomes canonical

`electron/main.js:373`:

```js
// Before
const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;

// After (if dropping IDEP_DATABASE entirely)
const overrideDir = process.env.IDEP_DATA_DIR;
```

`electron/main.js:441-442`:

```js
// Before
IDEP_DATABASE: DATA_PARENT,
IDEP_DATA_DIR: DATA_PARENT,

// After (if dropping IDEP_DATABASE entirely)
IDEP_DATA_DIR: DATA_PARENT,
```

Update `CLAUDE.md` to reference `IDEP_DATA_DIR`. Update R-side
`app_server.R` (and any other consumer the grep turned up) to read
`IDEP_DATA_DIR`.

If keeping `IDEP_DATABASE` as a backward-compat alias for users with
existing scripts:

```js
// keep the OR-fallback on read; drop the redundant write
const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;
// ...
env: {
  IDEP_DATA_DIR: DATA_PARENT,    // canonical
  // IDEP_DATABASE removed — R-side updated to read IDEP_DATA_DIR
}
```

Add a comment at the read site:

```js
// IDEP_DATABASE is accepted as a legacy alias for users with existing
// launch scripts. Prefer IDEP_DATA_DIR going forward.
const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;
```

### Path B — `IDEP_DATABASE` stays canonical

If the grep shows R-side reads `IDEP_DATABASE` extensively and there's
no appetite to rename, drop `IDEP_DATA_DIR` instead:

`electron/main.js:373`:

```js
const overrideDir = process.env.IDEP_DATABASE;
```

`electron/main.js:441-442`:

```js
IDEP_DATABASE: DATA_PARENT,
```

This is the smaller change but leaves a slightly worse name in place
("database" is misleading — it's a data directory, not a DB
connection string).

## Risks

- **User-facing env var change:** if any external users have set
  `IDEP_DATABASE` in scripts and support for it is dropped, those
  scripts break silently (the override quietly falls back to
  defaults). For a package with ~355 dependencies and a presumably
  installed user base, the safer path is keeping both as readable
  aliases for one or two releases, then dropping the deprecated one
  with a release note.
- **R-side rename:** any rename of the canonical name requires
  coordinated changes to R code. The grep step surfaces all consumers
  before any code moves.
- **Documentation drift:** `CLAUDE.md` and any user-facing docs need
  to match whichever name wins.

## Related

- [getRuntime candidate bloat](getruntime-candidate-bloat.md) — same
  review style.
- [createWindow dead branches](createwindow-dead-branches.md) —
  adjacent finding from the same scan.
- [Diagnostic R spawn runs every launch](createwindow-diagnostic-r-spawn.md)
  — adjacent finding from the same scan.
- [Auth throws-as-control-flow](auth-throws-as-control-flow.md) —
  the other spec note from this review pass.
- `CLAUDE.md` — currently references `IDEP_DATABASE`; will need
  update if Path A is chosen.
- [Electron changes summary](electron-changes-summary.md) — running
  list.
