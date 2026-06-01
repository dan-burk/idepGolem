# Monetization — Tiers, Trials & Billing

How the desktop app decides a user's **tier** (Free vs Pro), runs the free
trial, sells Pro, and — above all — stays **shut-off-able**.

> Status (May 2026): the **server side** (two Cloud Functions in
> `idep-functions`) is written and type-checks, but is **not yet deployed** —
> it needs the Stripe products/keys created first. The **desktop-app side**
> (sending the app-version header, the upgrade UI, parsing the new error
> codes, R-side feature-gating) is **not built**. See [§11](#11-current-state--whats-left).

This is the **monetization layer** that sits on top of the identity +
entitlement plumbing described in [`auth-and-entitlement.md`](auth-and-entitlement.md).
Read that first — this document assumes the OAuth flow, the entitlement JWT,
and the `/entitlement` function already make sense. New to JWT / OAuth / Stripe
terms? Keep [`../glossary.md`](../glossary.md) open.

---

## ⚠️ Where the code lives — this spans TWO repos

Like the auth system, the monetization layer is split:

| Repo | Holds |
|------|-------|
| **`idep-functions`** (separate repo) | All of it, server-side: the `/entitlement` and `/createCheckoutSession` Cloud Functions, the Stripe logic, the tier decision. `functions/src/index.ts`. |
| **`idepGolem`** (this repo) | The **desktop integration** — currently **pending**: sending the `X-IDEP-App-Version` header, an "Upgrade to Pro" action, dialogs for the new error codes, and R-side gating off `tier`. |

`idep-functions` carries its own `DOCUMENTATION.md` and a `next-steps.md` with
the deploy checklist. This document is the idepGolem-side record of *why* the
monetization layer is shaped the way it is.

---

## 1. The model

iDEP ships in two forms (see [`overview.md`](overview.md)): a free **web app**
and a **desktop app**. The business position:

- **The desktop app is itself the premium product.** Privacy (data never
  leaves the machine), stability, no server. The web app is the always-free
  floor — nobody is ever cut off from iDEP, only from the desktop convenience.
- Tiers are **Free** and **Pro** (`tier` in the entitlement JWT). That's the
  whole list — a *trial* is not a third tier, it's Pro with an end date.
- The hard requirement: **we must be able to cut off the desktop app for
  anyone, at any time.** Because the app can't be force-updated (the updater
  only *notifies*), the server must be the lever — and it is: a non-2xx from
  `/entitlement` makes the app fail closed and quit.

---

## 2. The two Cloud Functions

| Function | Purpose |
|----------|---------|
| **`/entitlement`** | Verifies the Google identity, decides the user's tier from Stripe, applies the free-tier policy, and signs the entitlement JWT. Called by the app on every auth refresh (~daily). |
| **`/createCheckoutSession`** | Returns a Stripe Checkout URL for buying Pro. The app opens it in the system browser. |

Both verify the same Google ID token the app already holds (one shared
`verifyGoogleEmail` helper). Identity is the **verified email** — there is no
Firebase UID (see [ADR 0002](../decisions/0002-google-oauth-not-firebase-auth.md)).

---

## 3. The tier decision — the `/entitlement` flow

On each call, in order:

```
[1] Verify the Google ID token            → verified email
[2] Revocation check (kill switch)         → 403 if killed/blocked
[3] Resolve tier from Stripe               → free | pro
[4] Free-tier policy                       → maybe 403 (block / update)
[5] Sign the entitlement JWT               → { tier, pro_until?, … }
```

Step **2** is the kill switch (see [§8](#8-the-kill-switch)). Step **3** is the
Stripe lookup (see [§4](#4-trials)). Step **4** is the post-trial policy (see
[§5](#5-the-free-tier-policy)). Step 5 emits the JWT the auth layer already
knows how to verify and cache.

If Stripe is unreachable, step 3 **fails open to `free`** — a Stripe outage
must not lock everyone out, and the 24h JWT means a wrongly-downgraded user
self-heals on the next refresh. The kill switch (step 2) still works regardless.

---

## 4. Trials

### Stripe owns the trial — we don't

On a customer's **first** sign-in the function creates a real Stripe
**trialing subscription** against the Pro price (`trial_period_days`, default
**60**). Stripe then owns the trial clock, the automatic `trialing → canceled`
transition when no card is added (`trial_settings.end_behavior:
missing_payment_method = cancel`), and the `trial_will_end` webhook.

The function **does not** store a `trial_ends_at` timestamp or do any date
math — it just reads `subscription.status`. Tier is `pro` for `active` or
`trialing`, `free` otherwise. Full rationale: [ADR 0008](../decisions/0008-stripe-native-trials.md).

A customer whose only subscriptions are `canceled` does **not** get a fresh
trial — the trial is created only when a customer has *zero* subscriptions.
The trial is **once per user** (the user keyed by verified email).

### The launch-promo window

There are **two timeframes**, and they are different things:

- **The per-user trial** — 60 days, from *that user's* signup.
- **The launch-promo window** — a fixed calendar deadline (`TRIAL_SIGNUP_DEADLINE`).
  A user is granted the trial **only if their Stripe customer was created
  on/before that deadline**; later sign-ups get no trial and start on `free`
  (the paywall).

Eligibility keys on `customer.created`, not "now" — so a user who qualified
keeps their full 60 days even if the launch window closes mid-trial. Empty
deadline = trials always granted (the default). Moving the deadline later
retroactively re-opens eligibility for anyone still subscription-less.

Why a date check and not a Stripe coupon: [ADR 0010](../decisions/0010-launch-promo-date-not-coupon.md).

---

## 5. The free-tier policy

When step 3 resolves a user to `free`, `FREE_TIER_POLICY` decides what happens
— and **"block" and "force-update" are the same logic**: a free user can't run
*unless some condition holds*.

| `FREE_TIER_POLICY` | Behaviour |
|--------------------|-----------|
| **`block`** (default) | `403 pro_required` → the app quits. No free desktop tier; the user upgrades to Pro or uses the free web app. |
| **`update`** | A free desktop tier exists, but only on a recent build: a build older than `FREE_GATING_MIN_VERSION` gets `403 update_required`; newer builds run with free features. |

It is a **runtime switch** — flipping `block` ↔ `update` needs no app rebuild.
Anything other than the literal `"update"` is treated as `block` (fail closed —
a misconfigured value can't accidentally give the app away).

This maps the two business routes directly: a hard paywall (`block`) versus a
reduced free desktop tier reachable by updating (`update`). The "forced update"
only makes sense under `update` — under `block` there is nothing to update
*to*, the user just goes to the web. The version gate is therefore a
*reduced-path* tool; it is harmless under `block`.

### Why `past_due` is not Pro

`PRO_STATUSES` is `["active", "trialing"]` — `past_due` is **deliberately
excluded**. Counting `past_due` would let a user fail a payment and keep Pro
through Stripe's multi-day retry window — the documented Datably "bypass
payment" hack (`firebase-functions/bypass-payment-hack-issue.md`). A failed
renewal drops the user to Free immediately.

---

## 6. Buying Pro — `/createCheckoutSession`

The app calls this with the user's Google ID token; it returns a Stripe
**Checkout Session URL**, which the app opens in the system browser. Once
payment completes, the customer's Pro subscription becomes `active` and the
next `/entitlement` call returns `pro`.

- Subscription-mode Checkout. **No `payment_method_types`** — Stripe selects
  eligible methods dynamically (a Stripe best practice).
- **`allow_promotion_codes: true`** — coupons and promo codes created in the
  Stripe dashboard (launch discounts, academic codes, comps) work with zero
  extra code. Promo codes belong *here*, in the purchase flow — not in the
  automatic launch trial ([ADR 0010](../decisions/0010-launch-promo-date-not-coupon.md)).
- **v1 limitation:** buying *during* an active trial starts paid billing
  immediately — remaining trial days are not carried over. Preserving them, or
  converting in place via the Stripe Customer Portal, is deferred.

---

## 7. Stripe as the user directory

iDEP has no Firestore mirror (Datably's pattern). Instead the **Stripe Customer
object is the user directory.** Every user gets a Customer on first sign-in,
carrying:

- `email` — Stripe Customers have a native email field; **no subscription is
  needed to record an email.**
- `metadata`: `source`, `first_seen`, and `last_seen` + `app_version`
  refreshed on every call.

So every user is visible in the Stripe dashboard — with their email and
current desktop app version — whether or not they ever pay. A free or churned
user is a Customer + a `canceled` subscription; that canceled subscription is
itself the record "trialed, didn't convert."

This is why there is **no `$0` free-tier subscription**: tracking does not need
one. Rationale: [ADR 0009](../decisions/0009-no-zero-dollar-free-subscription.md).

---

## 8. The kill switch

Step 2 of `/entitlement` reads the `ENTITLEMENT_REVOCATIONS` secret — a JSON
document:

```json
{ "killSwitch": false, "blockedEmails": ["someone@example.com"] }
```

- `killSwitch: true` → **everyone** gets `403`.
- An email in `blockedEmails` → that user gets `403`.

Editing it is publishing a new secret version — no redeploy. A `403` makes the
desktop app fail closed and quit. Propagation is bounded by the entitlement
JWT's 24h `exp` (see [ADR 0004](../decisions/0004-entitlement-expiry-offline-grace.md))
— a revoked user is out within ~24h online.

> Defeating the kill switch: the dev auth bypass (`IDEP_APP=dev`) skips all
> auth. It is gated on `!app.isPackaged`, so it has **no effect in a packaged
> release build** — a technical user setting the env var on a shipped app still
> hits the full auth flow.

---

## 9. Worked example — `john@gmail.com`

**Day 0, first sign-in.** App POSTs the Google token to `/entitlement`. The
function: verifies → `john@gmail.com`; revocation clear; `customers.list` empty
→ creates `cus_John`; `subscriptions.list` empty → (signup is within the launch
window) creates `sub_John`, a 60-day trialing subscription → `tier: pro`,
`pro_until` = Day 60. App caches the JWT, runs full.

**Days 1–59, the loop.** Reopen within 24h → the cached JWT is still valid →
`/entitlement` is **not called**. First reopen after 24h → cache expired →
`/entitlement` called → `cus_John` found, `sub_John` is `trialing` → `pro`
again. Roughly one read per day; no writes; **no new trial** (a subscription
exists).

**Day 60, trial ends, no card added.** Stripe itself flips `sub_John` →
`canceled`. Next refresh: `sub_John` is `canceled`, no `active`/`trialing`
match → `tier: free` → the free-tier policy applies (`block` → `403`, app
quits → web; or `update` → run if the build is recent enough).

**John pays.** Via `/createCheckoutSession` → Stripe Checkout → a Pro
subscription goes `active` → next `/entitlement` → `pro`.

The mental model: the trial subscription is **born once**; every return after
that is a pure *read* of subscription status.

---

## 10. Config & deployed coordinates

GCP project `idep-496415`, region `us-central1` (see [ADR 0005](../decisions/0005-one-gcp-project-per-product.md)).

**Secrets (Secret Manager):**

| Secret | Holds |
|--------|-------|
| `entitlement-signing-key-private` | ES256 private key — signs the entitlement JWT. Pre-existing (created in the Secret Manager console). |
| `STRIPE_RESTRICTED_KEY` | A Stripe **restricted** key (`rk_…`), scoped to Customers / Subscriptions / Checkout Sessions write — never a full `sk_` key. |
| `ENTITLEMENT_REVOCATIONS` | The kill-switch JSON ([§8](#8-the-kill-switch)). |

Secrets created via `firebase functions:secrets:set` must be `UPPER_SNAKE_CASE`
(the CLI requires it) — hence the two new ones above.

**Params** (`functions/.env.idep-496415` or prompted at deploy):
`GOOGLE_OAUTH_CLIENT_ID`, `TRIAL_DAYS` (60), `TRIAL_SIGNUP_DEADLINE` (empty),
`STRIPE_PRO_PRICE_ID`, `FREE_TIER_POLICY` (`block`), `FREE_GATING_MIN_VERSION`
(`0.0.0`), `CHECKOUT_SUCCESS_URL`, `CHECKOUT_CANCEL_URL`.

**Error codes** a `403` can carry: `missing_id_token`, `invalid_id_token`,
`email_not_verified`, `service_unavailable`, `access_revoked`, `pro_required`,
`update_required`.

---

## 11. Current state & what's left

**Done (server side, in `idep-functions`):** both functions written and
type-checking — tier resolution, Stripe-native trials, the launch-promo window,
the free-tier policy, the kill switch, Pro checkout.

**Not done:**

1. **Deploy.** Create the Pro product + recurring Price in Stripe; create the
   restricted key; set the secrets; `firebase deploy`. Checklist:
   `idep-functions/next-steps.md`.
2. **Desktop app (`idepGolem`):**
   - Send the `X-IDEP-App-Version` header on the `/entitlement` call — required
     before `FREE_TIER_POLICY=update` can gate by version.
   - Parse the `403` error codes into clean dialogs (e.g. `pro_required` →
     "trial ended, upgrade or use the web app").
   - An "Upgrade to Pro" action that calls `/createCheckoutSession` and opens
     the URL.
3. **R / Shiny:** gate Pro features off `session$userData$identity$tier` — and
   decide *what* Free vs Pro actually gates (a product decision).
4. **Later:** Stripe Customer Portal (in-place trial→paid conversion), a
   subscription webhook, usage telemetry for the `update`-policy free tier.

---

## See also

- [`auth-and-entitlement.md`](auth-and-entitlement.md) — the identity + JWT
  plumbing this layer sits on.
- [`overview.md`](overview.md) — where this fits in the whole system.
- [ADR 0008](../decisions/0008-stripe-native-trials.md) · [0009](../decisions/0009-no-zero-dollar-free-subscription.md) · [0010](../decisions/0010-launch-promo-date-not-coupon.md) — the monetization decisions.
- `idep-functions/DOCUMENTATION.md` and `next-steps.md` — the server repo's own docs.
