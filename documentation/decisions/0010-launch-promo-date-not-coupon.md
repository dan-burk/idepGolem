# ADR 0010 — Launch-promo window is a date check, not a Stripe coupon

**Status:** Accepted · **Date:** 2026-05

## Context

The launch promo grants the 60-day trial only to users who sign up within a
fixed window after launch (e.g. 30 days); later sign-ups hit the paywall.

Stripe has a rich promotions system — coupons (with `redeem_by` and
`max_redemptions`) and customer-facing promotion codes. The question: should
the launch window be a Stripe coupon, or function-side logic?

## Decision

The launch window is a **function-side check**: a `TRIAL_SIGNUP_DEADLINE`
param, compared against `customer.created`. If the customer was created on or
before the deadline they are granted the trial; otherwise they start on `free`.

Stripe promotion codes are **not** used for the launch window. They are
reserved for the actual purchase flow, where `allow_promotion_codes` is enabled
on the Pro Checkout Session — that is where discounts, academic codes, and
comps belong.

## Rationale

- A coupon is a **discount**; the free period is a **trial** ([ADR 0008](0008-stripe-native-trials.md)).
  Modelling "60 days free" as a 100%-off coupon reintroduces the messy
  charge-fails-at-expiry behaviour the trial avoids.
- Promotion **codes** are *user-entered* at a redemption point. The launch
  window is automatic and code-less — every signup in the window just gets it.
  There is nothing to redeem.
- `redeem_by` (the one coupon field that maps to "signup deadline") exists
  **only on coupons**. Stripe has no native "trial signup deadline." So the
  date check fills a genuine gap — unlike the trial itself (ADR 0008), it is
  not reinventing a Stripe primitive.

## Consequences

- One param, switchable without an app rebuild: empty = trials always granted;
  a date = the window; a past date = promo over.
- Eligibility keys on `customer.created`, so a qualifying user keeps their full
  trial even after the window closes.

## Alternatives considered

- **A 100%-off coupon with `redeem_by`** — rejected (the charge-at-expiry mess;
  couples the deadline to a discount mechanism).

## Notes

If the promo ever becomes **"first N users"** instead of "first N days," that
is `max_redemptions` on a coupon, which Stripe enforces atomically and a date
check cannot — revisit the coupon route then.
