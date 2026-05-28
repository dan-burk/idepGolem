# Finding bloat in `getRuntime()` — read the code, beat a confession out of it

**Date:** 2026-05-27
**Status:** Fix applied 2026-05-28 after the new dev scripts were verified on
a separate development machine. See "Proposed fix" section below for the
before/after diffs that landed.

## How this finding happened

I (Daniel) decided to spend an afternoon learning JavaScript with one
concrete goal: be able to read `electron/main.js` line by line and
reason about what it does. Coming from R, JS was unfamiliar territory
and the Electron shell felt like a black box I was relying on without
understanding.

After ~two hours of REPL exercises — arrow functions, `.map()`,
ternaries, `typeof`, `===` vs `==`, the rest-parameter `...args` — I
started reading `main.js` from line 1 with a guide walking me through
each piece.

By line 60 — the `getRuntime()` helper that locates the bundled R
runtime — something looked wrong. The function checks **five** candidate
folder paths on Windows, three on macOS, three on Linux, accepting
whichever exists on disk:

```js
const roots = [
  path.join(rp, 'runtime', 'R.win'),
  path.join(rp, 'R.win'),
  path.join(rp, 'resources', 'R.win'),
  path.join(rp, 'runtime', 'R-Portable'),
  path.join(rp, 'R-Portable'),
];
const R_ROOT = roots.find(fs.existsSync);
```

That's the code equivalent of *"I'm not sure where my keys are, let me
check five places."* It's a smell if you actually own the building. We
own the building.

## What was actually true

Cross-referencing the three CI workflows, the three dev scripts, and a
packaged install confirmed the production paths are fixed:

- **CI workflows** stage R at exactly one location per platform:
  - Windows: `electron/runtime/R.win/`
  - Linux: `electron/runtime/R.linux/`
  - macOS: `electron/runtime/R.framework/`
- **Dev scripts** used to put R at three *different* locations:
  - Windows: `electron/runtime/win/R/` — matched **none** of the candidates
  - Linux: `electron/scripts/r-linux/R/` — matched none
  - macOS: `electron/scripts/r-mac/R/` — matched none
- The `R-Portable` candidates: not produced by anything currently in
  the repo. Legacy alias.

So the five Windows "candidates" reduce to:

1. The one CI produces.
2–3. Variations nothing produces.
4–5. A legacy name nothing produces.

`roots.find(fs.existsSync)` always returned candidate #1 in production
and `undefined` in dev mode. The candidate list expressed uncertainty
that didn't exist in production, and was actively *wrong* for dev mode —
the dev scripts produced paths the list didn't include, so `npm start`
silently failed to find R.

## Provenance

The current `getRuntime()` body and all three dev scripts originate
from commit `f47623b` (2025-11-29) — the same commit that introduced
the Electron scaffold:

```
commit f47623b7191b77903fb090696ef58158dee08836
Date:   Sat Nov 29 06:25:11 2025 -0600

    Electron Packaging for Widows and MAC

 21 files changed, 6393 insertions(+), 32 deletions(-)
```

`main.js` (594 lines), all three dev scripts, all three CI workflows
landed together. Nothing in the candidate lists has been touched since
— every line traces back to that commit.

This is a common shape for any large initial scaffold: the pieces work
*individually* (R installs, packages install, CI builds an installer
that runs) but the cross-piece contracts — like "where does the dev
script put R" matching "where does `main.js` look for R" — aren't
exercised together until someone tries to use both halves on the same
machine. Production builds run through the CI half only; local dev runs
through the dev-script half only. Neither path stresses the contract
between them.

This finding is what happens when those halves get exercised in
sequence by the same person reading the code carefully.

## The lesson

**Read the code. Beat a confession out of it.**

Bloat hides in defensive lists that no one stress-tests because they
"work." `roots.find(fs.existsSync)` finds the production path; nobody
notices the other four are dead until someone walks each one by hand
and asks *"when would this one ever fire?"*

When the answer is *"no path in this repo ever produces that"* — delete it.
When the answer is *"I'm not sure"* — that's the real find. The codebase
doesn't know its own state.

A focused afternoon of reading by someone unfamiliar with the file
found this in a few hours. A drive-by review by someone fluent in JS
might skip past it because everything "works." The unfamiliarity *is
part of the skill* — the fluent eye glides over noise; the unfamiliar
eye stops at every word and asks "is this needed?"

The broader pattern: large one-shot scaffold drops land working code,
but the working state can mask internal inconsistencies between sibling
files. Each piece of such a drop deserves an independent read — not as
a verdict on the original author, but because the *cross-piece*
contracts are exactly what no single piece can verify by itself.

---

## Proposed fix to `main.js`

The three dev scripts have now been aligned with CI to produce the
production layout (`runtime/R.win/`, `runtime/R.linux/`,
`runtime/R.framework/`). Once that change has been verified end-to-end
on at least one dev machine, the candidate lists in `main.js` can
collapse to a single path each.

### Windows — `electron/main.js` lines ~60–68

Before:

```js
const roots = [
  path.join(rp, 'runtime', 'R.win'),
  path.join(rp, 'R.win'),
  path.join(rp, 'resources', 'R.win'),
  path.join(rp, 'runtime', 'R-Portable'),
  path.join(rp, 'R-Portable'),
];
const R_ROOT = roots.find(fs.existsSync);
const binDir = R_ROOT ? path.join(R_ROOT, 'bin') : null;
```

After:

```js
const R_ROOT = path.join(rp, 'runtime', 'R.win');
const binDir = path.join(R_ROOT, 'bin');
```

The `fs.existsSync(rscript)` check one block later already catches the
"R isn't bundled" case, so the upfront existence check buys nothing.

### macOS — `electron/main.js` lines ~97–102

Before:

```js
const candidates = [
  path.join(rp, 'runtime', 'R.framework', 'Resources', 'bin', 'Rscript'),
  path.join(rp, 'R.framework', 'Resources', 'bin', 'Rscript'),
  path.join(rp, 'resources', 'R.framework', 'Resources', 'bin', 'Rscript'),
];
const rscript = candidates.find(fs.existsSync);
```

After:

```js
const rscript = path.join(rp, 'runtime', 'R.framework', 'Resources', 'bin', 'Rscript');
```

### Linux — `electron/main.js` lines ~120–124

Before:

```js
const roots = [
  path.join(rp, 'runtime', 'R.linux'),
  path.join(rp, 'R.linux'),
  path.join(rp, 'resources', 'R.linux'),
];
const R_ROOT = roots.find(fs.existsSync);
```

After:

```js
const R_ROOT = path.join(rp, 'runtime', 'R.linux');
```

### Applied (2026-05-28)

The dev scripts were verified end-to-end on a separate development
machine, satisfying the "wait for a real install to confirm the
documented path" caveat. The collapse landed in the same change set
that introduces this note's status update. Linux also gained the same
"fail loudly with a dialog if bundled R is missing" pattern that
Windows and macOS already had — replacing the silent fallback to
system `Rscript`, which would mask a missing bundle.

---

## Related

- `documentation/architecture/overview.md` — the three-layer model
  (Shiny app, Electron shell, auth backend).
- `documentation/guides/electron-dev-mode.md` — the new `npm run dev`
  workflow that surfaces problems like this one by exercising the
  Electron shell without the full runtime.
- `documentation/notes/electron-changes-summary.md` — the running list
  of cleanup items being worked through on the Electron stack.
