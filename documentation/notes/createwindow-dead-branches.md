# createWindow: dead branches and guards that can't fire

**Date:** 2026-05-28
**Status:** Spec — ready to implement. Low risk.
**Trigger:** next intentional pass through `electron/main.js` startup
code. Can be bundled with the diagnostic-spawn cleanup
([createwindow-diagnostic-r-spawn.md](createwindow-diagnostic-r-spawn.md))
or done standalone — same file, same review surface.

## How this finding happened

After a long line-by-line read of `electron/main.js` with Claude as a
JS tutor — same exercise that produced
[getruntime-candidate-bloat.md](getruntime-candidate-bloat.md) the day
before — I made it to line 373 and was running out of focus. Rather
than push through the last 200 lines half-attentively, I asked Claude
to do a broad AI overview scan from line 373 to end-of-file looking
for the same kinds of issues the line-by-line read had been turning
up: bloat, dead branches, defensive code that can't fire, non-standard
idioms.

This note captures the three findings of the same family: defensive
branching that always produces the same outcome. Same shape as the
`getRuntime()` candidate-list bloat — code that *looks* like it's
handling multiple cases when it has only ever produced one.

## Finding 1 — `env?.R_LIBS || path.join(...)` always falls through

`electron/main.js:447`:

```js
R_LIBS_USER: env?.R_LIBS || path.join(path.dirname(rscript), '..', 'library'),
```

Traced through all three platforms by checking what `getRuntime()`
returns and where R packages actually live:

| Platform | `env.R_LIBS` from `getRuntime()` | Fallback resolves to |
|---|---|---|
| Windows | `runtime/R.win/library` | `runtime/R.win/library` |
| macOS | *(unset)* | `runtime/R.framework/Resources/library` |
| Linux | *(unset)* | `runtime/R.linux/library` |

On Windows, `env.R_LIBS` and the fallback resolve to the same path. On
macOS and Linux, `env.R_LIBS` is unset so the fallback fires — and it
fires correctly because R packages on those platforms really do live
at `<rscript>/../library`. The ternary never picks one branch over the
other in any meaningful way.

The `?.` is also unnecessary: `env` was destructured from `runtime` at
line 394 after `if (!runtime) { app.quit(); return; }`, so `env` is
guaranteed defined at this point.

## Finding 2 — `R_LIBS_USER` is set twice on Windows

`electron/main.js:73-80` (inside `getRuntime()`'s Windows branch):

```js
env: {
  R_HOME: R_ROOT,
  R_LIBS: libDir,
  R_LIBS_USER: libDir,        // ← set here
  R_LIBS_SITE: '',
  R_USER: R_ROOT,
  PATH: ...,
}
```

Then `electron/main.js:438-451` (the spawn call):

```js
env: {
  ...process.env,
  ...env,                      // ← R_LIBS_USER from above spread in
  ...
  R_LIBS_USER: env?.R_LIBS || ...,   // ← overwritten with same value
  ...
}
```

JavaScript object spread is later-wins, so the assignment at line 447
silently overwrites the one inside `getRuntime()`. Both resolve to the
same path, so functionally nothing changes — but the first
`R_LIBS_USER` line is dead.

`R_LIBS_SITE: ''` in the same `getRuntime()` block is also suspicious
— setting it to empty string explicitly tells R "look nowhere for site
libraries." That may have been intentional (force a clean library
state) but is worth a one-line comment if kept, or removal if
accidental.

## Finding 3 — Guards that can't fire on `childProc.stdout` / `childProc.stderr`

`electron/main.js:463-478`:

```js
if (childProc && childProc.stdout) {
  childProc.stdout.on('data', d => log('[R stdout]', String(d).trim()));
}

if (childProc && childProc.stderr) {
  childProc.stderr.on('data', d => { ... });
}
```

At this point in `createWindow`:

- `childProc` was assigned at line 436 inside a try block.
- The catch block (line 454) calls `app.quit(); return;` — so if
  `spawn` threw, control never reaches line 463.
- `spawn()` returns a `ChildProcess` object that always has `.stdout`
  and `.stderr` properties (they're streams unless `stdio` was
  customized, which it wasn't).

All four guard expressions are guaranteed truthy. The `if` bodies
always execute. Same dead-branch family as the other two findings.

## Why change it

These three are individually small, but together they communicate
something corrosive: **the code expresses uncertainty about its own
state that doesn't exist.** A reader sees `env?.R_LIBS || ...` and
thinks "ah, sometimes `R_LIBS` is set, sometimes it isn't, and the
fallback handles the latter." They have to spend time tracing it to
realize the branching is theatrical.

That cognitive tax compounds across a file. The `getRuntime()` cleanup
showed how much friction defensive-looking-but-unconditional code adds
when someone tries to reason about the runtime path. These three are
the same pattern in different places.

## Proposed changes

### Finding 1 — `electron/main.js:447`

Before:

```js
R_LIBS_USER: env?.R_LIBS || path.join(path.dirname(rscript), '..', 'library'),
```

After:

```js
R_LIBS_USER: path.join(path.dirname(rscript), '..', 'library'),
```

### Finding 2 — `electron/main.js:73-80`

Before:

```js
env: {
  R_HOME: R_ROOT,
  R_LIBS: libDir,
  R_LIBS_USER: libDir,
  R_LIBS_SITE: '',
  R_USER: R_ROOT,
  PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(';'),
},
```

After:

```js
env: {
  R_HOME: R_ROOT,
  R_USER: R_ROOT,
  PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(';'),
},
```

Remove `R_LIBS`, `R_LIBS_USER`, and `R_LIBS_SITE`. The library path is
set at the spawn call (line 447, after Finding 1 cleanup), which is
the canonical place. Setting them here too just gets overwritten — and
reading them here misleads future readers into thinking this is the
source of truth.

`R_LIBS_SITE: ''` specifically: if you decide it WAS intentional, move
it to the spawn call with a one-line comment explaining why. If you
can't articulate a reason, drop it.

### Finding 3 — `electron/main.js:463-478`

Before:

```js
if (childProc && childProc.stdout) {
  childProc.stdout.on('data', d => log('[R stdout]', String(d).trim()));
}

if (childProc && childProc.stderr) {
  childProc.stderr.on('data', d => {
    const text = String(d);
    log('[R stderr]', text.trim());
    const m = text.match(/Listening on http:\/\/[^:]+:(\d+)/);
    if (m) {
      shinyPortFromLog = Number(m[1]);
      log(`[port detect] Shiny reports listening on port ${shinyPortFromLog}`);
    }
  });
}
```

After:

```js
childProc.stdout.on('data', d => log('[R stdout]', String(d).trim()));

childProc.stderr.on('data', d => {
  const text = String(d);
  log('[R stderr]', text.trim());
  const m = text.match(/Listening on http:\/\/[^:]+:(\d+)/);
  if (m) {
    shinyPortFromLog = Number(m[1]);
    log(`[port detect] Shiny reports listening on port ${shinyPortFromLog}`);
  }
});
```

## Optional inline fix to bundle into the same PR

`electron/main.js:378` — silent `mkdirSync` failure on `DATA_PARENT`:

```js
try { fs.mkdirSync(DATA_PARENT, { recursive: true }); } catch {}
```

If this throws (read-only filesystem, permissions, disk full), the
spawn block at line 436 hits a confusing `cwd not found` error
downstream instead of a clear "couldn't create data directory"
message. The same fail-loudly pattern as the existing bootstrap.R
check at line 414 should apply.

After:

```js
try {
  fs.mkdirSync(DATA_PARENT, { recursive: true });
} catch (e) {
  const msg = `Could not create data directory at ${DATA_PARENT}\n${e.message}\nLog: ${LOG_FILE}`;
  log('[FATAL]', msg);
  try { dialog.showErrorBox('Data Directory Error', msg); } catch {}
  app.quit(); return;
}
```

Not in the dead-branch family — it's a separate "fail loudly" gap —
but small and adjacent, so worth pulling into the same PR while the
file is open.

## Risks

- **`R_LIBS` removal on Windows (Finding 2):** the spawn call at line
  447 sets `R_LIBS_USER` to the same path. R's library resolution
  checks `R_LIBS_USER`, `R_LIBS_SITE`, and `R_LIBS` in a specific
  order; removing `R_LIBS` could theoretically change behavior if some
  package relies on `R_LIBS` specifically. In practice, `.libPaths()`
  would still include the directory via `R_LIBS_USER`. Verify with a
  packaged Windows build before merging — load any iDEP feature that
  hits a Bioconductor package, confirm it loads.
- **`R_LIBS_SITE: ''` removal:** if it was deliberately preventing R
  from looking at a system-wide site library on the user's machine
  (rare on Windows desktops; possible on Linux servers), removing it
  could leak unexpected packages into the runtime. Decide
  intentionally rather than by inertia.
- **No test impact:** no tests touch this code path.

## Related

- [getRuntime candidate bloat](getruntime-candidate-bloat.md) — the
  original finding that established this review pattern.
- [Diagnostic R spawn runs every launch](createwindow-diagnostic-r-spawn.md)
  — adjacent finding from the same scan.
- [Data-dir env-var normalization](data-dir-env-var-normalization.md)
  — adjacent finding from the same scan.
- [Auth throws-as-control-flow](auth-throws-as-control-flow.md) — the
  other spec note from this review pass.
- [Electron changes summary](electron-changes-summary.md) — running
  list.
