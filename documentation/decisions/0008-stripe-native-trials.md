# ADR 0008 — Stripe-native trials, not a hand-rolled trial clock

**Status:** Accepted · **Date:** 2026-05

## Context

Every new desktop user gets a free trial of Pro. The `/entitlement` function
needs to know, on each call, whether a user is still in their trial.

The first implementation hand-rolled this: a `trial_ends_at` timestamp written
into Stripe customer metadata, and date arithmetic in the function
(`now < trial_ends_at → pro`). That works — but it reimplements something
Stripe's subscription engine already does.

## Decision

On a customer's first sign-in, create a real Stripe **trialing subscription**
against the Pro price — `trial_period_days`, with
`trial_settings.end_behavior.missing_payment_method = "cancel"`. The function
then derives tier purely from `subscription.status` (`active`/`trialing` → Pro)
and never tracks trial time itself.

## Consequences

- Stripe owns the trial clock, the automatic `trialing → canceled` transition
  when no card is added, and the `trial_will_end` webhook — none of which we
  maintain.
- Every user has a subscription object (and a `canceled` one if they never
  convert). Accepted: it is also accurate dashboard visibility — trial-to-churn
  shows natively.
- "Buying Pro" stays clean — the user already has a subscription; conversion is
  adding a payment method, not bolting tier state onto a metadata field.
- A failed-renewal/cancellation is reflected by Stripe's own status, so the
  `past_due` bypass and similar bugs are easier to reason about.

## Alternatives considered

- **Hand-rolled `trial_ends_at` metadata** — rejected. Reinvents a Stripe
  primitive; more code; hand-rolled billing logic is where bugs hide.
- **A 100%-off coupon as the free period** — rejected. A coupon is a *discount*;
  at coupon expiry Stripe tries to *charge* and the subscription goes
  `past_due` — the messy ending the trial's clean `end_behavior: cancel`
  avoids.
