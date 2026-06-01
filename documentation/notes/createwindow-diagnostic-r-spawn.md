# createWindow: "OPTIONAL" diagnostic R spawn runs on every launch

**Date:** 2026-05-28
**Status:** Spec — ready to implement. Low risk.
**Trigger:** next intentional pass through `electron/main.js` startup
code. Can be bundled with the dead-branches cleanup
([createwindow-dead-branches.md](createwindow-dead-branches.md)) or
done standalone.

## How this finding happened

I'd been working through `electron/main.js` line by line with Claude
as a JS tutor and ran out of focus around line 373. Rather than push
through the last 200 lines half-attentively, I asked Claude to do a
broad AI overview scan from there to end-of-file for the same kinds
of issues the line-by-line read had been turning up.

This block stood out immediately because of the contradiction between
its comment and its behavior. The comment says "OPTIONAL: one-time
diagnostics." The code runs every single launch.

That's the exact same shape as the `getRuntime()` candidate-list
bloat: code that *describes* itself as defensive or optional but has
quietly become permanent overhead.

## What the current code does

`electron/main.js:397-409`:

```js
// OPTIONAL: one-time diagnostics
try {
  const diag = spawn(rscript, ['-e',
    "cat('LIBPATHS:\\n', paste(.libPaths(), collapse='\\n'), '\\n')"
  ], {
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  diag.stdout.on('data', d => log('[R diag stdout]', String(d).trim()));
  diag.stderr.on('data', d => log('[R diag stderr]', String(d).trim()));
} catch (e) {
  log('[R diag error]', e && e.stack ? e.stack : String(e));
}
```

Spawns a complete R subprocess every time `createWindow()` runs (i.e.
every launch) just to print `.libPaths()` to the log. The "OPTIONAL"
comment is aspirational — there is no flag, env var, or condition
that turns it off.

## Why change it

**1. R startup is slow.** A cold R subprocess takes one to several
seconds to initialize before it can even execute the `-e` argument.
The main Shiny spawn at line 436 follows immediately after, doing the
same startup cost again. Users pay for two R cold starts on every
launch instead of one.

**2. The output is only useful when debugging.** `.libPaths()` is a
diagnostic check that confirms R is finding the bundled package
directory. Useful when investigating "why won't my package load."
Useless 99% of the time.

**3. Shiny logs its own library paths during normal startup anyway** —
package loading messages go through the `[R stderr]` handler at line
467. So even when debugging, the dedicated diagnostic spawn is mostly
redundant with what's already being captured.

**4. The comment is a lie.** Either the code should match the comment
("OPTIONAL: one-time"), or the comment should match the code (no
claim of optionality). Both options are better than a contradiction
that ages into "what was this person thinking" the next time someone
reads it.

## Proposed change

Two acceptable forms. Pick one.

### Option A — Gate behind a debug env var

For when someone has ever actually used this output to find a bug, or
expects to.

```js
if (process.env.IDEP_DEBUG) {
  try {
    const diag = spawn(rscript, ['-e',
      "cat('LIBPATHS:\\n', paste(.libPaths(), collapse='\\n'), '\\n')"
    ], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    diag.stdout.on('data', d => log('[R diag stdout]', String(d).trim()));
    diag.stderr.on('data', d => log('[R diag stderr]', String(d).trim()));
  } catch (e) {
    log('[R diag error]', e && e.stack ? e.stack : String(e));
  }
}
```

- **Pros:** preserves the diagnostic for investigations
  (`IDEP_DEBUG=1 npm start`).
- **Cons:** adds a documented env var that has to be remembered.

### Option B — Delete the block entirely

```js
// (block removed)
```

- **Pros:** simpler. Users still get library path info from the
  normal R startup output via the `[R stderr]` handler if a package
  fails to load.
- **Cons:** gone for good. If a future bug ever requires this exact
  output, someone adds it back temporarily.

### Recommended choice

**Option B** unless someone can name a specific past incident where
the `[R diag stdout]` output (separately from normal R stderr) was
the thing that pinpointed a bug. If no such incident exists, the
block has never paid for itself.

## Risks

- **Option A (gated):** none. Default behavior changes from "always
  run" to "never run unless flagged."
- **Option B (deleted):** if a future startup issue surfaces that's
  hard to diagnose without `.libPaths()` output, equivalent code gets
  added back temporarily. Cheap to recreate from this note.
- **No test impact:** no tests touch this code.

## Related

- [getRuntime candidate bloat](getruntime-candidate-bloat.md) — same
  pattern (code described as defensive/optional that has become
  permanent overhead).
- [createWindow dead branches](createwindow-dead-branches.md) —
  adjacent finding from the same scan.
- [Data-dir env-var normalization](data-dir-env-var-normalization.md)
  — adjacent finding from the same scan.
- [Auth throws-as-control-flow](auth-throws-as-control-flow.md) — the
  other spec note from this review pass.
- [Electron changes summary](electron-changes-summary.md) — running
  list.
