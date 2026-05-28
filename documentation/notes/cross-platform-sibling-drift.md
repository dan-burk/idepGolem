# Cross-platform sibling drift — a feature of vibe coding

**Date:** 2026-05-28
**Status:** Finding documented; today's instance fixed in `get_r_windows.ps1`.

## How this finding happened

While getting `npm run dev` to work on a new Windows machine, the
PowerShell setup script `electron/scripts/get_r_windows.ps1` failed when
invoked from `electron/` instead of `electron/scripts/`. R got staged at
`idepGolem/runtime/R.win/` (repo root) instead of
`electron/runtime/R.win/`, and the subsequent `idepGolemDev` install
looked for the package at `idepGolem/idepGolemDev/` which doesn't exist.

The cause was one line:

```powershell
$repoRoot = Resolve-Path ".." | Select-Object -ExpandProperty Path
```

`Resolve-Path ".."` is **cwd-relative**, not script-relative. It works
only when you happen to run the script from `electron/scripts/`. Run it
from anywhere else and `..` resolves to the wrong directory.

The fix was to use `$scriptDir` (already computed at the top of the
script for logging) as the anchor:

```powershell
$electronDir = Split-Path -Parent $scriptDir
```

That alone wasn't the interesting part. The interesting part was checking
whether the same bug existed in the sibling scripts.

## What was actually true

`get_r_linux.sh` and `get_r_mac.sh` were both **correct**:

```bash
# get_r_linux.sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
```

```bash
# get_r_mac.sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
```

Both anchored on `SCRIPT_DIR`. Only the PowerShell script regressed to
cwd-relative resolution. **Two of three siblings shared the right
pattern; one slipped.**

## Why this matters

This was code that had been explicitly aligned. The user asked AI to
walk over the three scripts and confirm they implemented the same
logical pattern. The alignment pass missed this one detail in the
PowerShell file — likely because `Resolve-Path ".."` *looks like* it
does the same thing as the bash idiom, and structurally the two scripts
both have something computing a parent directory in roughly the same
place.

A human writing all three scripts in one sitting would have either:

1. Used cwd-relative paths in all three (consistently wrong), or
2. Used script-relative paths in all three (consistently right).

The mental model they were carrying would have applied to all three
files. They wouldn't have switched anchors halfway.

AI-assisted coding doesn't carry one mental model across three files.
Each file is generated (or reviewed) with its own local context, its
own "good enough" threshold, and its own subtle drift. The output
**looks** parallel — same structure, same comments, same section
headers — but the precise mechanism can quietly diverge.

This is the same root cause as the
[[getruntime-candidate-bloat]] finding, viewed from a different angle:
both are **cross-piece contract failures**. There, the contract was
"where the dev script puts R" vs. "where main.js looks for R." Here, the
contract is "do these three sibling scripts behave the same way." In
both cases the asymmetry was invisible until someone read the files
line by line.

## The lesson

When reading AI-generated cross-platform code, **diff the siblings
structurally, not just functionally.** A file passing its own tests
tells you that file works in isolation. Two-of-three siblings agreeing
on a pattern is a stronger signal than any single file looking right.

The reading heuristic:

> When you see three platform-specific files (`*.ps1`, `*.sh`, `*.sh`),
> stack them and walk down line by line. If two share a pattern the
> third doesn't, that asymmetry is **probably a bug, not a deliberate
> platform difference**.

The producing heuristic:

> Asking AI to "align these three files" is a useful pass but not a
> sufficient one. Small annoying inconsistencies still slip through
> even when alignment is the explicit goal. Treat the alignment pass as
> a 90% solution, not a 100% one — and budget time for a manual
> structural diff afterward.

This isn't a knock on AI-assisted coding. It's a feature of the
medium: high-throughput, locally-coherent output with quiet drift at
the edges. Knowing this, you read differently. You stop trusting
"these three files look parallel" and start asking "are they parallel
*on the specific line that matters*?"

## Related

- [[getruntime-candidate-bloat]] — sibling finding: the original Electron
  scaffold had cross-piece contract failures between dev scripts and
  `main.js`. Same shape of bug, different cross-piece axis.
- `electron/scripts/get_r_windows.ps1` — the fix landed here.
- `electron/scripts/get_r_linux.sh`, `get_r_mac.sh` — the two siblings
  that were already correct, and which made the inconsistency visible.
