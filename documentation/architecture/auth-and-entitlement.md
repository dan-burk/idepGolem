# Authentication & Entitlement

How the desktop app proves **who** a user is and **what they're allowed to do**,
before the analysis app starts.

> Status (May 2026): the identity + entitlement plumbing is complete and
> shipping in the Windows/Linux/macOS installers. The monetization layer on top
> of it (Stripe tiers, Pro feature-gating) is **not** built yet — see
> [§6](#6-current-state--whats-left).

New to the terms here (JWT, PKCE, ES256…)? Keep [`../glossary.md`](../glossary.md)
open.

---

## ⚠️ Where the code lives — this system spans TWO repos

The auth system is **not contained in this repository.** It is split across two
GitHub repos — you cannot fully understand or safely change it from `idepGolem`
alone:

| Repo | Holds | Deploys to |
|------|-------|------------|
| **`idepGolem`** (this repo) | The **client** side: Electron auth code (`electron/auth.js`, `entitlement.js`, `cache.js`, `hmac.js`), R-side verification (`R/auth_helpers.R`), and the embedded ES256 **public** key. | the desktop installers |
| **`idep-functions`** (separate repo) | The **server** side: the `/entitlement` Cloud Function — verifies Google ID tokens, determines tier, and **signs** the entitlement JWT with the ES256 **private** key. | Google Cloud (Firebase Functions v2) |

They are separate on purpose: the two halves deploy to entirely different places
on different schedules (one inside desktop installers, one as a GCP server), so
either can be redeployed without touching the other.

The **contract** between them is deliberately small and stable: the function
emits an ES256-signed entitlement JWT; the app verifies it with the embedded
public key. As long as that JWT shape and the keypair are unchanged, the repos
evolve independently — **but a change to the JWT format or the keypair requires
a coordinated change in BOTH repos.**

`idep-functions` carries its own `DOCUMENTATION.md` for the function's internals.

---

## 1. Why this exists

iDEP's business goal is a **Free / Pro / Enterprise** model. For that, the
desktop app must:

1. Know **who** the user is (identity).
2. Know **what tier** they're entitled to (Free vs Pro).
3. Gate Pro features accordingly.
4. Do it with near-zero login friction, offline tolerance, and no per-user
   vendor cost.

This system is the foundation for all of that. It currently delivers steps 1–2;
steps 3–4 are the next workstream.

The design chosen is **native OAuth 2.0 with PKCE and a loopback redirect**:
Electron owns the OAuth tokens, and a signed handshake passes identity down to
the R/Shiny child process. (Alternatives considered — a hosted identity
provider, license keys — and why they lost: see
[`../decisions/0001-native-pkce-oauth.md`](../decisions/0001-native-pkce-oauth.md).)

---

## 2. The flow, end to end

Everything below happens before the user sees the iDEP UI.

```
On app launch:

[1] Electron checks the safeStorage-cached entitlement JWT.
    ├─ valid (or within 7-day offline grace) ─────────────────► go to [7]
    └─ missing / expired ─────────────────────────────────────► continue

[2] Electron starts the PKCE flow:
      - generate code_verifier + code_challenge
      - start a loopback HTTP server on http://127.0.0.1:<ephemeral-port>
      - open the Google authorization URL in the user's real browser

[3] User signs in with Google in their system browser.

[4] Google redirects to http://127.0.0.1:<port>/callback?code=...

[5] Electron exchanges {code + code_verifier} with Google
      → receives id_token + access_token + refresh_token

[6] Electron POSTs the Google id_token to the /entitlement Cloud Function:
      - the function verifies the id_token against Google's JWKS
      - the function determines tier  (v1: hardcoded "free"; later: Stripe)
      - the function signs an entitlement JWT with the ES256 PRIVATE key
      - Electron verifies that JWT with the embedded ES256 PUBLIC key
      - Electron caches it, encrypted, via safeStorage

[7] Electron generates a per-install 256-bit HMAC secret and passes it to
    the R/Shiny process as the SHINY_HMAC_SECRET env var when spawning Rscript.

[8] For the Shiny session, Electron mints a short-lived (~5 min) HMAC-signed
    JWT and injects it as `Authorization: Bearer <jwt>` on every request to
    the local Shiny server (via webRequest.onBeforeSendHeaders).

[9] R/Shiny verifies that JWT with SHINY_HMAC_SECRET and learns the user's
    identity + tier — without R ever talking to Google or Stripe.
```

Key property: **R never contacts Google or Stripe.** All external auth happens
in Electron; R only ever verifies a local, symmetric handshake. That keeps the
R side simple and offline-capable.

`IDEP_AUTH_DISABLED=1` in the environment bypasses steps 1–9 entirely — an
emergency/dev escape hatch.

---

## 3. The two JWTs

The system uses **two distinct JWTs with two distinct signing schemes.** This is
deliberate, and understanding why is the key to the whole design.

| | **Entitlement JWT** | **Session JWT** |
|---|---|---|
| Asserts | "this user is licensed, tier = X" | "this request came from the trusted Electron shell" |
| Signed by | the `/entitlement` Cloud Function | Electron's main process |
| Algorithm | **ES256** (asymmetric) | **HS256** (symmetric / HMAC) |
| Key | private key in Secret Manager (server only) | one shared secret, generated per install |
| Verified by | Electron, with the **public** key embedded in the app | R/Shiny, with the **same** shared secret |
| Lifetime | 24h expiry + 7-day offline grace | ~5 minutes |
| Claims | `email`, `tier`, `features`, `exp`, `grace_until` | identity + tier, short expiry |

**Why ES256 (asymmetric) for the entitlement JWT.** The desktop app must be able
to *verify* an entitlement, but must **never** be able to *forge* one — otherwise
any user could mint themselves a "tier: enterprise" token. Asymmetric signing is
the only scheme that allows this: the private (signing) key stays server-side in
Secret Manager; only the public (verifying) key ships in the app, and a public
key cannot create signatures. See
[`../decisions/0003-two-jwt-signing-schemes.md`](../decisions/0003-two-jwt-signing-schemes.md).

**Why HS256 (symmetric) for the session JWT.** The Electron process and the R
process both run on the user's machine and inherently trust each other — Electron
*spawned* R. The only goal is to stop *other* programs on the machine from
talking to the local Shiny port. A shared secret that never leaves the two
cooperating processes is simpler and sufficient; asymmetric signing would be
overkill.

**Why expiry + grace on the entitlement.** 24h expiry means an online user's
entitlement refreshes daily (so a cancelled subscription stops working within a
day). The 7-day `grace_until` means an offline user keeps working for a week
before the app drops them to Free — a standard offline-licensing pattern. See
[`../decisions/0004-entitlement-expiry-offline-grace.md`](../decisions/0004-entitlement-expiry-offline-grace.md).

---

## 4. Components

### GCP side — project `idep-496415`
- A dedicated GCP project under the `orditus.com` organization (one project per
  product — see [`../decisions/0005-one-gcp-project-per-product.md`](../decisions/0005-one-gcp-project-per-product.md)).
- **OAuth consent screen** — External; scopes `openid email profile` (all
  non-sensitive, so no Google security review). Currently in **Testing** mode,
  which caps sign-in at ~100 users; flipping to Production is a pending task.
- A **Desktop-type OAuth Client ID**.
- **Secret Manager** holds the ES256 private signing key.
- How this was provisioned: [`../guides/gcp-auth-setup.md`](../guides/gcp-auth-setup.md).

### The `/entitlement` Cloud Function — repo `idep-functions`
- Firebase Functions v2, TypeScript. Deployed at
  `https://entitlement-auzgq7lgsq-uc.a.run.app`.
- Receives a Google ID token → verifies it against Google's JWKS → determines
  tier → signs an entitlement JWT (`jose`, ES256) with the Secret Manager key.
- **v1 returns a hardcoded `tier: "free"`** — the Stripe lookup is the main
  unbuilt piece.
- Lives in its own repo with its own `DOCUMENTATION.md`.

### Electron side — repo `idepGolem`, `electron/` folder
| File | Responsibility |
|------|----------------|
| `auth.js` | The PKCE OAuth flow — loopback server, browser launch, code exchange. |
| `entitlement.js` | Verifies the entitlement JWT against the embedded public key; `entitlementStatus()` → `valid` / `grace` / `expired`. |
| `cache.js` | `safeStorage`-encrypted on-disk cache of the entitlement JWT. |
| `hmac.js` | The per-install HMAC secret and per-session JWT minting. |
| `auth-integration.js` | Orchestrator — ties the above into `main.js`. |
| `main.js` | Runs the auth gate before spawning R; passes `SHINY_HMAC_SECRET` in the spawn env; injects the `Authorization` header; **Account → Sign Out** menu. |
| `test-auth.js` | Standalone CLI that exercises the full PKCE → entitlement → verify chain without a build. |
| `keys/idep-entitlement-public.pem` | The ES256 **public** key — committed on purpose; it's meant to be public. |
| `.env` / `.env.example` | OAuth credentials. `.env` is gitignored; CI writes it from GitHub Actions secrets at build time. |

### R / Shiny side — repo `idepGolem`
| File | Responsibility |
|------|----------------|
| `electron/bootstrap.R` | Reads `SHINY_HMAC_SECRET`, exposes it as an R option. |
| `R/auth_helpers.R` | `verify_shiny_jwt()` and `shiny_identity_from_session()`. |
| `DESCRIPTION` | Adds the `jose` R package (JWT verification). |

> **Pending wiring:** one line in `R/app_server.R` —
> `session$userData$identity <- shiny_identity_from_session(session)` — to
> actually populate the identity into the Shiny session. Until it's added, the
> R side verifies the handshake but doesn't yet *use* the identity.

---

## 5. Deployed coordinates (quick reference)

| Thing | Value |
|-------|-------|
| GCP project | `idep-496415` (number `997360372911`), org `orditus.com` |
| Entitlement function | `https://entitlement-auzgq7lgsq-uc.a.run.app` |
| Secret Manager secret | `entitlement-signing-key-private` (ES256 private key) |
| OAuth client type | Desktop app; scopes `openid email profile` |
| Code repos | `idepGolem` (Electron + R/Shiny), `idep-functions` (Cloud Function) |

---

## 6. Current state & what's left

**Done:** identity + entitlement plumbing end-to-end; installers shipping on all
three platforms; Sign Out; auto-update notification.

**Not done — the monetization layer:**

1. Flip the OAuth consent screen **Testing → Production** (else capped at ~100
   users).
2. Decide **what "Pro" means** — which features are Free vs Pro. A product
   decision; blocks the rest.
3. Create the iDEP **Stripe** account + products + price IDs.
4. Replace the hardcoded `tier: "free"` in `/entitlement` with a real Stripe
   lookup by verified email.
5. Wire `shiny_identity_from_session()` into `R/app_server.R` (one line).
6. Gate Pro features in the R UI off `session$userData$identity$tier`.

The **authoritative, live checklist** is `roadmap.md` in the `iDEP-ShinyGO`
strategy repo (`auth-pricing-setup/roadmap.md`). It is intentionally **not**
copied here — a live checklist with open business decisions should have exactly
one home, or the copies drift. This document describes what *exists*; the
roadmap tracks what's *next*.

---

## See also

- [`overview.md`](overview.md) — where this fits in the whole system.
- [`../decisions/`](../decisions/) — the *why* behind each design choice.
- [`../guides/gcp-auth-setup.md`](../guides/gcp-auth-setup.md) — recreating the
  GCP backend.
- [`../guides/gcp-iam-cheatsheet.md`](../guides/gcp-iam-cheatsheet.md) — IAM and
  the first-deploy gotchas.
