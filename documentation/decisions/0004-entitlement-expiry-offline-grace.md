# ADR 0004 — Entitlement: 24h expiry + 7-day offline grace

**Status:** Accepted · **Date:** 2026-05

## Context

The entitlement JWT says "this user is tier X." It's cached on disk
(`safeStorage`) so the user doesn't sign in every launch. Two opposing pressures:

- A **cancelled or downgraded** subscription should stop granting Pro **soon**.
- A user **temporarily offline** (no network) should not be locked out of an
  app they paid for.

A token with no expiry solves offline but never reflects a cancellation. A
token that expires hard and fast solves cancellation but breaks offline use.

## Decision

The entitlement JWT carries **two** time claims:

- `exp` — **24 hours.** While online, the app refreshes the entitlement daily.
- `grace_until` — **7 days.** While offline, an expired entitlement keeps
  working until this point; after it, the app drops the user to Free.

## Consequences

- A cancellation takes effect within ~24h for an online user — acceptable.
- An offline user keeps full access for up to a week, then degrades gracefully
  to Free rather than failing hard.
- This is a standard offline-licensing pattern; no novel mechanism to maintain.

## Notes

Background refresh of a stale-but-not-expired entitlement is **not** yet
implemented — today the app only refreshes after the 7-day grace lapses or on an
explicit Sign Out. Tracked as a deferred item in the auth roadmap.
