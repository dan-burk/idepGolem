# iDEP Documentation

Developer-facing documentation for the iDEP project — how the system is built,
how the pieces fit together, why it's done that way, and what the terminology
means.

> This is **not** end-user documentation. Tutorials for *using* iDEP to analyze
> data live in the R package's `vignettes/` folder. This folder explains the
> system to whoever has to *maintain* it.

## Start here

If you are new to the codebase (or returning after a while), read in this order:

1. **[architecture/overview.md](architecture/overview.md)** — the whole system
   on one page: the three layers and how a launch flows end to end.
2. **[glossary.md](glossary.md)** — plain-English definitions of every term used
   in the codebase (JWT, OAuth, PKCE, HMAC, Electron, Golem, …). Keep it open
   while reading anything else.
3. **[architecture/auth-and-entitlement.md](architecture/auth-and-entitlement.md)**
   — the auth/entitlement system in full, if that's your area.
4. **[architecture/monetization.md](architecture/monetization.md)** — the
   Stripe tiers, trials, and Pro checkout layered on top of auth.

## Folder map

| Path | What it holds |
|------|---------------|
| `architecture/` | How the system works. Evergreen — kept accurate to the code. |
| `glossary.md` | Definitions of concepts and jargon. |
| `decisions/` | Architecture Decision Records — *why* each significant choice was made. Append-only. |
| `guides/` | Practical how-to documents (building, packaging, GCP setup, dev mode). |
| `notes/` | Historical writeups, bug reports, and one-off implementation summaries. Point-in-time — **not** guaranteed current. |

## Practical how-tos

- [`guides/electron-dev-mode.md`](guides/electron-dev-mode.md) — `npm start` vs `npm run dev`, the dev setup, the diagnostic `idepGolemDev` app.
- [`guides/electron-packaging-guide.md`](guides/electron-packaging-guide.md) — packaging the desktop installers.
- [`guides/electron-build-linux.md`](guides/electron-build-linux.md) — Linux-specific build notes.
- [`guides/gcp-auth-setup.md`](guides/gcp-auth-setup.md) — Google Cloud auth + entitlement setup.
- [`guides/gcp-iam-cheatsheet.md`](guides/gcp-iam-cheatsheet.md) — IAM quick reference.

## Status

The `architecture/` section is being written incrementally:

| Document | Status |
|----------|--------|
| `architecture/overview.md` | ✅ written |
| `glossary.md` | ✅ written |
| `architecture/auth-and-entitlement.md` | ✅ written |
| `architecture/monetization.md` — Stripe tiers, trials, Pro checkout | ✅ written |
| `decisions/` (ADRs 0001–0010) | ✅ written |
| `guides/gcp-auth-setup.md`, `guides/gcp-iam-cheatsheet.md` | ✅ written |
| `architecture/shiny-app.md` — Golem structure, the 12 modules, reactive data flow | ⏳ to write |
| `architecture/desktop-app.md` — Electron shell, `main.js` lifecycle, R runtime bundling | ⏳ to write |
| `architecture/build-and-release.md` — the CI workflows and tag-driven releases | ⏳ to write |

## Related documentation elsewhere

Some material deliberately lives **outside** this repo:

- **The `iDEP-ShinyGO` strategy repo** (on the Orditus shared drive) holds
  forward-looking planning — auth/pricing research, the live monetization
  **roadmap**, IAM notes. That's evolving strategy, not a description of the
  code, so it has its own home. A live checklist should have exactly one copy.
- **The `idep-functions` repo** holds the iDEP Cloud Functions (`/entitlement`
  and `/createCheckoutSession`) with its own `DOCUMENTATION.md` and
  `next-steps.md`.

This folder describes what the iDEP code **is**; those describe what it might
**become** and the server-side piece.

## Conventions

- One topic per file. Keep files short enough to read in a sitting.
- When you change code that a doc describes, update the doc **in the same
  commit**. Docs that drift from code are worse than no docs.
- ADRs in `decisions/` are append-only — supersede with a new record, never
  rewrite a past one.
- Historical notes in `notes/` are left as-is — don't "fix" them to match
  current code; they are a record of a moment.
