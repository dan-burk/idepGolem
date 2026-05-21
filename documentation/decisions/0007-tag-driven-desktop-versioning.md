# ADR 0007 — Tag-driven desktop versioning (`desktop-v*`)

**Status:** Accepted · **Date:** 2026-05

## Context

A release tagged `v1.0.2` shipped installers named `1.0.1`, and the in-app
updater nagged users to "update" to a version they already had. Cause:
`electron/package.json`'s `version` field — which electron-builder's `${version}`
and `app.getVersion()` both read — had not been bumped to match the git tag.
There were **two** sources of truth (the tag and `package.json`) with **nothing**
keeping them in sync.

Separately, the repo carries two version streams: the desktop app (`1.0.x`) and
the iDEP analysis engine (`2.x`). Both used plain `v*` tags, so a web-engine tag
would also trigger the desktop build workflows.

## Decision

1. **`electron/package.json`'s `version` is the single source of truth.** A
   release tag must match it; CI **verifies this and fails fast** on a mismatch
   (in ~10s, before building).
2. **Use `npm version`** to release — it bumps `package.json`, commits, and
   creates the tag in one atomic step, so the two can't drift.
3. **Desktop release tags are prefixed `desktop-v`** (e.g. `desktop-v1.0.3`),
   set via `electron/.npmrc`'s `tag-version-prefix`. The build workflows trigger
   only on `desktop-v*`.

## Consequences

- A version mismatch is now impossible via the normal flow, and caught in
  seconds if someone hand-tags wrong.
- Desktop releases are cleanly separated from the engine's `v2.x` tags.
- `updater.js` strips the `desktop-v` prefix when comparing versions; apps built
  before this change can't parse the new prefix, so existing installs need one
  manual update before auto-update detection resumes.

## Alternatives considered

- **CI stamps the version from the tag** (tag is the sole source of truth).
  Simpler — one thing to push — but `package.json` then shows a meaningless
  placeholder. Rejected in favour of keeping `package.json` authoritative and
  human-visible, with a guard.
