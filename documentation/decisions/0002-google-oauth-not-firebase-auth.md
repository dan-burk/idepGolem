# ADR 0002 — Direct Google OAuth, not Firebase Auth

**Status:** Accepted · **Date:** 2026-05

## Context

Having chosen native OAuth ([ADR 0001](0001-native-pkce-oauth.md)), there's a
sub-choice: authenticate against **Google OAuth directly**, or go through
**Firebase Auth** (Google's higher-level auth product). Datably — Orditus's web
app — uses Firebase Auth, so there was precedent to match it.

## Decision

Use **Google OAuth 2.0 directly**. Do **not** use Firebase Auth for the desktop
app.

## Consequences

- The desktop app deliberately differs from Datably's auth stack. That's
  acceptable — they are different surfaces with different constraints.
- The app handles ID/access/refresh tokens itself.

## Rationale

- Firebase Auth is built for **web and mobile SDKs**. It does not fit a native
  desktop OAuth flow well.
- Google **bans embedded auth webviews** (since 2023) — desktop auth *must* use
  the system browser with a loopback redirect, which is plain OAuth 2.0
  territory, not Firebase's model.
- Going direct keeps the desktop flow simple and standard (RFC 8252).
