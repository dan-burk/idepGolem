# Electron shell audit — open to-dos

**Date:** 2026-06-01
**Status:** Open. Findings captured for follow-up; none of these are applied yet
(except where noted as already-done context).
**Trigger:** ad-hoc multi-agent audit run at the end of the electron-shell
cleanup session, after the `IDEP_AUTH_DISABLED` thread surfaced a live
security gap (the unguarded `IDEP_APP=dev` bypass, since fixed).

## How this was found

Three parallel read-only audit agents swept the electron shell and its R glue
for the same families we'd been clearing all session (dead branches,
legacy/renamed references, code/comment drift, "optional"-but-always-on code,
fail-open security gaps, two-names-for-one-concept config):

1. **Electron JS** — `electron/*.js`
2. **R glue + build scripts** — `bootstrap.R`, `idepGolemDev/`, `R/run_app.R`,
   `R/auth_helpers.R`, `electron/scripts/*`
3. **Config contract** — every env var / R option crossing the Electron↔R
   boundary, read-vs-write matrix

Two agents independently flagged the same #1 item (R-side HMAC not enforced),
which is the strongest signal in the set.

---

## 🔴 Needs a decision before fixing

### [ ] 1. R-side HMAC handshake is plumbed but never enforced (security)

**Confidence:** high (corroborated by 2 agents).
**Where:** `R/auth_helpers.R:20` (`verify_shiny_jwt`), `R/auth_helpers.R:58`
(`shiny_identity_from_session`) — defined, exported nowhere, and **called
nowhere**. `R/app_server.R` never reads `session$request$HTTP_AUTHORIZATION`
or `userData`.

The secret flows end-to-end: `main.js` sets `SHINY_HMAC_SECRET` →
`bootstrap.R:17-18` stores it as `options(idep.shiny_hmac_secret=...)` → the
verify helpers exist. But the production Shiny server verifies **no**
signatures, so the threat the handshake was designed to stop — another local
process hitting `127.0.0.1:<port>` without the injected JWT — is currently
open. Code comments mark this "Phase 2d/2e," so it is likely deliberately
deferred WIP rather than an oversight.

**Decision needed:** is wiring R-side enforcement in-scope now, or a known
later phase? Wiring it in involves a product decision (deny vs. fall back to
free tier on a missing/invalid signature).
**Suggested fix:** call `shiny_identity_from_session(session)` at the top of
`app_server` and gate on the result; or explicitly document that server-side
enforcement is not yet active.
**Note:** `verify_shiny_jwt` itself is correct and fails closed internally
(empty secret/jwt → `NULL`, missing `jose` → `NULL`, bad sig/exp/iss/aud →
`NULL`). The gap is purely that nothing calls it.

### [ ] 2. Offline-grace path appears unreachable (correctness)

**Confidence:** medium — needs a quick verification first.
**Where:** `entitlement.js:62-65` (the `grace`/`expired` returns), consumed at
`auth-integration.js` cache path.

`verifyEntitlement(cached)` runs before `entitlementStatus()`, and `jose`'s
`jwtVerify` enforces `exp` by default (throws `JWTExpired`). So an entitlement
past `exp` but inside its grace window throws, is caught, wipes the cache, and
forces re-auth — meaning an offline Pro user past `exp` is locked out, the
opposite of the documented offline-grace design
([ADR 0004](../decisions/0004-entitlement-expiry-offline-grace.md)). Either a
real bug or dead grace-branch code.

**Action:** verify whether `jose` rejects `exp` before `entitlementStatus` can
run (check for any `clockTolerance`/`currentDate` option). If confirmed, fix by
verifying signature/issuer/audience *without* exp enforcement, then let
`entitlementStatus` decide valid/grace/expired.

---

## 🟢 Safe cleanups (no decision, low risk)

- [ ] **`entitlement.js:34`** — comment references a renamed `isValid`; the
  function is now `entitlementStatus`. Update the comment. *(cleanliness, high)*
- [ ] **`entitlement.js:72-73`** — `loadPublicKey` and `PUBLIC_KEY_PATH` are
  exported "for testing" but imported nowhere (`test-auth.js` imports only
  `verifyEntitlement`/`entitlementStatus`). Drop both from `module.exports`,
  keep them internal. *(cleanliness, high)*
- [ ] **`electron/scripts/install_packages.R:4`** — header says "Called by
  get_r_linux.sh and get_r_windows.ps1"; it is actually invoked by the
  `build-electron-*` CI workflows (the dev scripts install only
  shiny/golem/idepGolemDev). Fix the header. *(cleanliness, high)*
- [ ] **`bootstrap.R:101`** — `options(idep.demo_data_dir = demo_dir_hint)` is
  set but read nowhere. Drop the `options()` call (keep the log line). The
  surrounding `demo_dir_hint` block is otherwise purely diagnostic logging.
  *(cleanliness, high)*

---

## 🟡 Cleanups that touch wider ground (confirm scope first)

- [ ] **`GE_DATABASE` — a third orphaned name for the data dir.** Read in 4
  vignettes (`vignettes/idep_Clustering.Rmd`, `idep_Enrichment.Rmd`,
  `idep_Load_Data.Rmd`, `idep_Pre_Process.Rmd`, ~line 27 each) via
  `Sys.getenv("GE_DATABASE")`, but **set nowhere** in the repo. Same family as
  the `IDEP_DATABASE`/`IDEP_DATA_DIR` work — a legacy pre-iDEP name ("GE" =
  gene expression) surviving only in vignette setup; those vignettes get an
  empty path unless the user manually exports it. Reconcile to
  `IDEP_DATA_DIR` (falling back to `IDEP_DATABASE`), matching `run_app.R`.
  *(correctness, high)* — see
  [data-dir-env-var-normalization.md](data-dir-env-var-normalization.md).
- [ ] **Delete `electron/scripts/install_packages-explicit.R`.** Orphaned dead
  duplicate of `install_packages.R` (the older hand-maintained package-list
  approach, superseded by the DESCRIPTION-driven `pak::local_install_deps`).
  Nothing references it; its "Called by …" header is false. *(cleanliness, high)*
- [ ] **`APPLE_ID_PASSWORD` phantom var.** `build-electron-mac.yml:29`
  (currently commented) defines `APPLE_ID_PASSWORD`, but `after-sign.js:26`
  reads `APPLE_APP_SPECIFIC_PASSWORD`. When notarization is re-enabled,
  `APPLE_ID_PASSWORD` would be set and silently ignored. Remove the stale
  line. *(cleanliness, latent)*
- [ ] **`bootstrap.R:35-62` and `:67-97`** — the `download.file`/`untar`
  monkey-patches run inside `try(..., silent = TRUE)`. If
  `unlockBinding`/`assign`/`lockBinding` fails on some R build, the demo-cache
  / skip-untar optimization is silently lost. Add a `message()` on failure so a
  broken patch shows up in `electron_r.log`. *(correctness, low impact)*

---

## ⚪ Noted — no action needed (recorded so they aren't re-flagged later)

- **`R_USER` / `R_LIBS_SITE` (`main.js`, Windows branch)** — written, no
  in-repo reader; consumed internally by the bundled R runtime to isolate the
  library tree. Intended. `R_LIBS_SITE` already carries an explanatory comment;
  `R_USER` could get a one-liner but is not wrong.
- **`idep.version_check_timeout`** — read at `R/fct_analysis_random.R:700`
  with a default of `4`, set nowhere. Intentional user-tunable override hook;
  undocumented, so `4s` is the de-facto value. Document or inline if desired.
- **`IDEP_DEBUG`** — appears only in
  [createwindow-diagnostic-r-spawn.md](createwindow-diagnostic-r-spawn.md) as a
  *proposed* gate (Option A), not in code. The diagnostic block it described
  was deleted (Option B). The note is a spec, not a description of current
  behavior — no drift to fix.
- **`electron/.env.example`** pins
  `ENTITLEMENT_URL=https://entitlement-…run.app` while the CI workflows inject
  `secrets.ENTITLEMENT_URL`. Same var name, not a contract break; minor — the
  example pins a value CI treats as a secret. Align if it bothers you.
- **`IDEP_DATABASE` legacy alias** — consistent across `main.js`,
  `run_app.R`, and the dev diagnostic; tracked by
  [data-dir-env-var-normalization.md](data-dir-env-var-normalization.md). The
  eventual consolidation (drop the alias after a release or two) lives there,
  not here.

---

## Already fixed this session (context, not to-do)

- `IDEP_APP=dev` auth bypass is now gated on `!app.isPackaged` in both
  `main.js` and `auth-integration.js` — fails closed in packaged builds.
- `IDEP_AUTH_DISABLED` fully removed (diagnostic app, `bootstrap.R` comment,
  and the three architecture docs, which now describe the bypass as
  `IDEP_APP=dev`).

## Related

- [Auth throws-as-control-flow](auth-throws-as-control-flow.md)
- [createWindow dead branches](createwindow-dead-branches.md)
- [Diagnostic R spawn](createwindow-diagnostic-r-spawn.md)
- [Data-dir env-var normalization](data-dir-env-var-normalization.md)
- [getRuntime candidate bloat](getruntime-candidate-bloat.md)
- [Electron changes summary](electron-changes-summary.md) — running list.
