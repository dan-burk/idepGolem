# ADR 0006 — Bundle the R runtime once, not twice

**Status:** Accepted · **Date:** 2026-05

## Context

The desktop installers bundle a complete R runtime (~355 packages). The macOS
`.dmg` had grown to ~2.1 GB — over GitHub Releases' 2 GiB per-asset limit — and
the macOS CI build began failing with "No space left on device".

After a long detour through dmg compression, `hdiutil` options, and runner disk
cleanup, the **actual root cause** was found in `electron/package.json`:
`runtime/**` and `app/**` were listed in **both** `build.files` **and**
`build.extraResources`. electron-builder treats those as independent copy
operations, so the multi-GB R runtime was packed into the `.app` **twice** — yet
the app only ever reads the `extraResources` copy (`main.js` resolves it via
`process.resourcesPath`). The `files` copy was dead weight.

## Decision

Remove `runtime/**` and `app/**` from `build.files`. Deliver them **only** via
`build.extraResources`.

## Consequences

- The `.app` (and the `.dmg`) roughly halved — the `.dmg` dropped under the
  2 GiB limit, so macOS publishes to GitHub Releases like Windows and Linux.
- The macOS CI build stopped running out of disk.
- Windows `.exe` and Linux `.deb` also shrank by one R runtime each — they were
  never broken, just silently bloated.

## Lesson

When an Electron app is mysteriously huge, check for the **same paths appearing
in both `files` and `extraResources`**. They are independent copy passes;
overlap silently duplicates everything they cover.
