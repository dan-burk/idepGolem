# Auth flow: replace throws-as-control-flow with a discriminated result

**Date:** 2026-05-28
**Status:** Spec — not yet implemented.
**Trigger:** must land before any work on the "Manage Billing" menu item.

## What this note is

A planned refactor of `ensureEntitlement` in `electron/auth-integration.js`
and its single caller in `electron/main.js`. Triggered by reading
`createWindow()` line by line and noticing that business outcomes (user's
trial ended → show upgrade dialog) and real errors (network failed,
signature invalid) flow through the same `throw` / `catch` pipe.

This is **not bloat** in the `getRuntime()` candidate-list sense — every
thrown path is reachable and serves a purpose. It is a design tradeoff
that's idiomatic in JS/Node but conceptually muddled. The cleanup is
queued now because the next planned change to this surface ("Manage
Billing") would otherwise widen the same problem.

## The current shape

`ensureEntitlement` (`electron/auth-integration.js:41`) either:

- returns `{ entitlement, identity, fromCache }` on success, or
- throws an `Error` with bolted-on properties:
  - `err.code` — e.g. `'pro_required'`, `'access_revoked'`
  - `err.userMessage` — human-readable text from the Cloud Function
  - `err.httpStatus` — the HTTP status that triggered the throw
  - `err.idToken` — the Google ID token, kept so the caller can start a
    Pro checkout

`createWindow` (`electron/main.js:338-359`) wraps the call in a single
`try { … } catch (err)` and discriminates *inside* the catch:

```js
try {
  const result = await ensureEntitlement(onProgress);
  identity = result.identity;
  hmacSecret = getOrCreateHmacSecret();
} catch (err) {
  if (err && err.code === 'pro_required') {
    await showProUpgradeDialog(err);
    app.quit(); return;
  }
  // generic error fallback
  dialog.showErrorBox('Sign-in Failed', /* … */);
  app.quit(); return;
}
```

## Why change it

Two problems live in the current shape.

**1. The catch block holds both real errors and expected user states.**

`pro_required` is not an exception. The user authenticated successfully
— they simply don't have a paid subscription. Treating it as a thrown
error makes the catch block do two unrelated jobs at once:

- handle real failures (network died, JWT bad, OAuth flow aborted), and
- route a known business outcome to its dialog.

A reader has to scan the entire catch block to know which branches are
"things went wrong" and which are "things went exactly as expected."

**2. There is no enforced list of known failure codes the caller must handle.**

`auth-integration.js:88` documents in a comment that the function can
produce `'pro_required'` or `'access_revoked'`. `main.js` only handles
`'pro_required'`. **`access_revoked` falls through to the generic
"Sign-in Failed" dialog**, which is wrong UX — a user whose access was
admin-revoked should see a tailored "your access has been revoked,
contact support" message, not a raw error box.

The current shape makes that gap easy to miss because the failure codes
are documented in one file and consumed in another with no link between
them. A discriminated result forces the caller to acknowledge each known
case explicitly, and surfaces unknown ones at runtime instead of
silently miscategorizing them.

## Why now

It isn't an emergency:

- The pattern works. Users with trial-ended see the upgrade dialog.
- `access_revoked` is a real gap but rare (admin-initiated).
- The thrown-error idiom is common across production JS codebases.

It earns the cleanup slot now because:

- Adding "Manage Billing" (planned next on this surface) means
  introducing another function in the same neighborhood
  (`startCustomerPortal`) that will face the same design question.
  Refactoring first sets the pattern once for both, rather than
  duplicating the old shape into new code and doubling the eventual
  cleanup surface.
- The `access_revoked` gap is real and gets fixed *by construction* in
  the new shape — no separate follow-up patch needed.

## Proposed changes

### `electron/auth-integration.js` — `ensureEntitlement`

Change the public return shape from `{ entitlement, identity, fromCache }`
plus throw-on-failure to a discriminated union. Every *known* failure
mode becomes a returned value with a `reason` discriminator; unexpected
failures (programmer errors, malformed responses, missing config) still
throw.

New return shape:

```js
// success
{ ok: true, entitlement, identity, fromCache }

// known failures
{ ok: false, reason: 'pro_required',   message, idToken }
{ ok: false, reason: 'access_revoked', message, idToken }
{ ok: false, reason: 'auth_failed',    message }              // PKCE/OAuth aborted
{ ok: false, reason: 'network_error',  message }              // /entitlement unreachable
{ ok: false, reason: 'server_error',   message, httpStatus }  // 5xx / unrecognised code
```

Implementation outline:

1. The HTTP non-OK branch (currently `auth-integration.js:76-93`) stops
   throwing. Build a structured result based on `code` — recognised
   codes (`pro_required`, `access_revoked`) get their own `reason`;
   unrecognised becomes `server_error`.
2. The PKCE call (currently `auth-integration.js:64-68`, failures
   propagate) gets a wrapping try/catch that converts known PKCE
   rejections to `{ ok: false, reason: 'auth_failed', message }`.
3. The `/entitlement` fetch (currently `auth-integration.js:72-75`, no
   explicit catch) gets a wrapping try/catch that converts network
   errors (DNS, refused, abort) to
   `{ ok: false, reason: 'network_error', message }`.
4. `throw` is retained ONLY for programmer-error conditions — the config
   check at `auth-integration.js:27-32` stays as-is. Anything that's a
   *response from the world* becomes a returned value.

### `electron/main.js` — `createWindow`

Replace the `try { … } catch (err)` block (currently
`main.js:338-359`) with a branch on `result.reason`:

```js
const result = await ensureEntitlement(onProgress);

if (result.ok) {
  identity = result.identity;
  hmacSecret = getOrCreateHmacSecret();
  log('[auth]', `Signed in as ${identity.email} (tier=${identity.tier}, fromCache=${result.fromCache})`);
} else {
  switch (result.reason) {
    case 'pro_required':
      await showProUpgradeDialog(result);
      break;
    case 'access_revoked':
      await showAccessRevokedDialog(result);
      break;
    case 'auth_failed':
    case 'network_error':
    case 'server_error':
      dialog.showErrorBox('Sign-in Failed', result.message);
      break;
    default:
      // surfaces any new reason added upstream that we haven't handled yet
      dialog.showErrorBox('Sign-in Failed', `Unknown failure: ${result.reason}`);
  }
  app.quit(); return;
}
```

`showProUpgradeDialog` currently takes `err` and reads `err.userMessage`
and `err.idToken`. Update the parameter name to `result` and read
`result.message` / `result.idToken`. Same data, new names.

### `showAccessRevokedDialog` — new helper

Sibling of `showProUpgradeDialog`. Brief dialog explaining the access
was revoked and pointing the user at support. No checkout button. Lives
in `main.js` next to `showProUpgradeDialog`. Roughly:

```js
async function showAccessRevokedDialog(result) {
  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['OK'],
    title: 'Access Revoked',
    message: 'Your iDEP access has been revoked.',
    detail: (result && result.message) ||
      'Please contact support if you believe this is in error.',
  });
}
```

### What stays the same

- Internal helpers (`verifyEntitlement`, `loadEntitlement`,
  `saveEntitlement`, `runPKCEFlow`) keep throwing on failure. They're
  implementation detail; their throws are absorbed by `ensureEntitlement`
  and converted to structured results at the public boundary.
- `startProCheckout` keeps its current shape — single caller, single
  failure mode, no business outcomes to discriminate.
- The HMAC / per-session JWT machinery in `setupShinyRequestAuth` is
  untouched.

## The `access_revoked` gap

Currently: a user whose access has been revoked sees the generic
"Sign-in Failed: Entitlement HTTP 403: …" dialog. Wrong UX — they need
to know the block is deliberate, not a transient bug.

In the refactor: `access_revoked` becomes a first-class `reason` in the
discriminated result, handled by the new `showAccessRevokedDialog`. If
the case is ever accidentally removed from the `switch`, the `default`
branch surfaces it as `Unknown failure: access_revoked` rather than
silently miscategorizing as a network error.

The gap is *not* patched ahead of the refactor — a one-line `else if`
in the existing catch would be dispatch code the refactor immediately
deletes. Better to fix it once, in the new shape.

## Sequencing

1. **Now → before "Manage Billing"**: this refactor lands as a single PR
   touching `electron/auth-integration.js` and `electron/main.js`. No
   existing tests touch `ensureEntitlement` — `electron/test-auth.js`
   imports `runPKCEFlow`, `verifyEntitlement`, and `entitlementStatus`
   directly, all of which the refactor leaves untouched.
2. **After this lands**: the Manage Billing menu work begins, building
   on the already-clean shape. Will get its own spec note.

The "Manage Billing" feature is the triggering condition. Manage Billing
must not be merged while the throws-as-control-flow shape is still in
place — adding a second function with the same problem doubles the
cleanup surface for no benefit.

## Risks

- **External callers:** as of writing, the only caller of
  `ensureEntitlement` is `main.js:340`. If a second caller appears
  before the refactor lands, the work item grows.
- **Cloud Function additions:** if the backend starts returning a new
  error code that isn't yet mapped to a `reason`, it falls into the
  `server_error` bucket on the auth-integration side and (if surfaced
  as a `reason` value the switch doesn't know) into the `default`
  branch on the main.js side. Visible failure mode rather than silent
  miscategorization — acceptable.

## Related

- [getRuntime candidate bloat](getruntime-candidate-bloat.md) — earlier
  finding from the same line-by-line read of `main.js`. Different
  category (dead code vs design tradeoff) but same review style.
- [Electron changes summary](electron-changes-summary.md) — running
  list of electron-side cleanup items.
- [Architecture overview](../architecture/overview.md) — three-layer
  model context.
- (Planned) `documentation/notes/manage-billing-menu.md` — feature add
  that depends on this refactor landing first.
