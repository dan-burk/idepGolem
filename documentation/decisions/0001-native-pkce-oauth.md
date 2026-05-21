# ADR 0001 — Native OAuth 2.0 + PKCE for desktop auth

**Status:** Accepted · **Date:** 2026-05

## Context

The iDEP desktop app needs to identify users (for the Free/Pro monetization
model). Options for how a desktop app authenticates users:

1. **Native OAuth 2.0 with PKCE** — the app runs the OAuth flow itself against
   Google, using a loopback redirect and the user's real browser.
2. **A hosted identity provider** (e.g. WorkOS) — outsource login to a vendor.
3. **License keys** — issue users a key to paste in, no identity provider.

## Decision

Use **native OAuth 2.0 with PKCE** (referred to as "Approach #1" in the auth
research specs). Electron owns the OAuth flow and the resulting tokens.

## Consequences

- Lowest possible login friction — users already have a Google account.
- Near-zero cost and no per-user vendor billing.
- No vendor lock-in.
- The app must implement the OAuth/PKCE flow itself (done — `electron/auth.js`).
- Enterprise SAML/SSO is not covered by this; a hosted-IdP swap-in (WorkOS) is
  kept as a *future* option for when an enterprise customer needs it.

## Alternatives considered

- **Hosted IdP** — adds vendor cost and lock-in for a capability (basic
  identity) that Google OAuth already provides for free. Deferred to enterprise.
- **License keys** — no real identity, poor UX (manual key handling), and harder
  to tie to a per-user subscription. Rejected.
