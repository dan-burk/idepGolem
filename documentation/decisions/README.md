# Decision Records (ADRs)

This folder holds **Architecture Decision Records** — short notes that capture
*why* a significant choice was made, what was rejected, and what it costs.

An ADR is not a tutorial and not a spec. It's a half-page answer to "why on
earth is it done this way?" — written so that six-months-from-now-you (or a new
contributor) doesn't have to re-derive the reasoning or re-litigate a settled
question.

**Format.** Each record has: Status, Date, Context, Decision, Consequences, and
(where relevant) Alternatives considered.

**Rules.**
- ADRs are append-only and immutable. If a decision changes, write a *new* ADR
  that supersedes the old one — don't edit history.
- Number them sequentially: `NNNN-short-title.md`.

## Index

| # | Decision |
|---|----------|
| [0001](0001-native-pkce-oauth.md) | Native OAuth 2.0 + PKCE for desktop auth |
| [0002](0002-google-oauth-not-firebase-auth.md) | Direct Google OAuth, not Firebase Auth |
| [0003](0003-two-jwt-signing-schemes.md) | Two JWTs: ES256 entitlement + HS256 session |
| [0004](0004-entitlement-expiry-offline-grace.md) | Entitlement: 24h expiry + 7-day offline grace |
| [0005](0005-one-gcp-project-per-product.md) | One GCP project per product |
| [0006](0006-bundle-r-runtime-once.md) | Bundle the R runtime once, not twice |
| [0007](0007-tag-driven-desktop-versioning.md) | Tag-driven desktop versioning (`desktop-v*`) |
| [0008](0008-stripe-native-trials.md) | Stripe-native trials, not a hand-rolled trial clock |
| [0009](0009-no-zero-dollar-free-subscription.md) | Free tier is the absence of a subscription, not a $0 one |
| [0010](0010-launch-promo-date-not-coupon.md) | Launch-promo window is a date check, not a Stripe coupon |
