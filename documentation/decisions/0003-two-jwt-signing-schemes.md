# ADR 0003 — Two JWTs: ES256 entitlement + HS256 session

**Status:** Accepted · **Date:** 2026-05

## Context

Two separate trust boundaries need a signed token:

1. **Server → desktop app:** the `/entitlement` Cloud Function tells the app
   "this user is licensed, tier = X." The app must *verify* this but must never
   be able to *forge* it.
2. **Electron → R/Shiny:** the Electron shell tells its local R child process
   "this request is genuinely from me." Both processes are on the same machine
   and already trust each other.

## Decision

Use **two distinct JWTs with two distinct signing schemes:**

- **Entitlement JWT — ES256 (asymmetric).** Signed by the Cloud Function with a
  private key kept in Secret Manager. Verified by the app with the matching
  public key, embedded in the app.
- **Session JWT — HS256 (symmetric / HMAC).** Signed and verified with one
  shared secret, generated per install, passed to R via `SHINY_HMAC_SECRET`.

## Consequences

- A user who fully inspects the app finds only the **public** key — which cannot
  create signatures. Entitlements cannot be forged client-side. This is the
  whole point of using asymmetric signing for boundary 1.
- The HMAC secret never leaves the two cooperating local processes, so it's safe
  and simple for boundary 2.
- Two code paths to maintain (`entitlement.js` / `hmac.js`), but each is small
  and the separation is conceptually clean.

## Rationale

Asymmetric (ES256) is **required** for the entitlement JWT — it is the only
scheme where the verifier cannot also forge. Symmetric (HS256) would be a
security hole there. Conversely, asymmetric signing for the local handshake
would be needless complexity: both endpoints are trusted and co-located, so a
shared secret is correct and simpler.
