# ADR 0009 — Free tier is the absence of a subscription, not a $0 one

**Status:** Accepted · **Date:** 2026-05

## Context

iDEP's sibling product Datably gives **every** user a `$0` subscription on a
"free" price, so that every customer always has exactly one subscription. The
question was whether iDEP should do the same for its Free tier.

A separate worry pushed the same way: if free users have *no* subscription, are
they still *tracked*?

## Decision

**Free is the absence of an active/trialing paid subscription.** There is no
`$0` subscription object. Tier resolves to `free` whenever the customer has no
`active`/`trialing` subscription.

Every user still gets a Stripe **Customer** on first sign-in — the Customer
object (native `email` field + `metadata`: `first_seen`, `last_seen`,
`app_version`) is iDEP's user directory. A free or churned user is a Customer
plus a `canceled` subscription.

## Consequences

- No `$0` invoice generated every billing cycle per free user.
- No "re-create the free subscription on cancel" logic — which in Datably is
  exactly what enabled an indefinite re-subscribe / payment-bypass loop.
- No Firestore-vs-Stripe reconciliation tangle (Datably's `getOrCreateCustomer`
  is ~270 lines largely about keeping a `$0` sub consistent).
- **Tracking is unaffected** — the Customer object holds the email and
  metadata. A `$0` subscription was never needed to know who a user is.

## Alternatives considered

- **A `$0` free-price subscription for every user** (the Datably pattern) —
  rejected. Its only real wins are a uniform "everyone has one subscription"
  model, showing Free in a Stripe Pricing Table, and letting Stripe
  *Entitlements* enumerate free-tier features. iDEP needs none of those today.

## Notes

If iDEP later adopts Stripe **Entitlements** to enumerate *Free*-tier features
specifically (Pro features can use Entitlements without this), or wants Free in
a hosted Pricing Table, a free product/subscription would be worth revisiting.
