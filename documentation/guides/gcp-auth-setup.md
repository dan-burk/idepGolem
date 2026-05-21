# Guide: Provisioning the GCP Auth Backend

How iDEP's Google Cloud auth backend was set up — the console work that must
exist before any auth code runs. Use this to understand the deployed setup, or
to recreate it.

> This recipe is **product-agnostic** — it works for ShinyGo or any future
> desktop product. iDEP's actual values are shown inline as `(iDEP: …)`.
> The reusable template lives in the strategy repo (`auth-pricing-setup/`).

## Mental model (read first)

GCP nests: **Organization** (your company) → **Project** (one per product) →
**Services** (OAuth, Secret Manager — enabled per project).

**Rule:** one project per product. A product's web and desktop versions *share*
the project — they split at the OAuth Client ID level, not the project level.
Same project = same login identity, one bill, one entitlement function. (Why:
[`../decisions/0005-one-gcp-project-per-product.md`](../decisions/0005-one-gcp-project-per-product.md).)

## 1. Create the GCP project

Console → project dropdown → **New Project**. Name it after the product, set the
organization. *(iDEP: project `idep-496415`, org `orditus.com`.)*

## 2. Configure the OAuth consent screen

The popup users see when signing in. Required before creating any OAuth Client ID.

**Branding** — APIs & Services → OAuth consent screen (newer UI: "Google Auth
Platform" → "Branding"):
- User Type: **External**
- App name: the product name
- Support email / Developer contact: your address. *Note:* the dropdown only
  lists Google accounts **you personally own** — group aliases like `info@org`
  won't appear unless they're real Google accounts.

**Audience:**
- Keep **Publishing status: Testing** for now — it caps you at 100 users but
  skips Google's verification form. Switch to Production before launch (needs
  homepage + privacy-policy URLs). *(iDEP: still in Testing — flipping to
  Production is a pending task.)*
- **Add test users** — yourself and anyone testing. Required even in Testing
  mode, or their sign-in is blocked.

**Data Access → scopes** — add exactly these three, no more:
- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

These are "non-sensitive" → no multi-week Google security review.

## 3. Create the Desktop OAuth Client ID

Clients → **+ Create Client** → Application type: **Desktop app**. Name it
`<Product> Desktop` (internal label only). Copy the **Client ID** and **Client
secret** to a password manager.

*Why a secret at all for a desktop app:* per RFC 8252 §8.5 the secret is treated
as non-secret (a desktop app can't truly hide it — which is exactly why PKCE
exists), but Google still requires it on token exchange.

## 4. Secret Manager + the signing keypair

The `/entitlement` Cloud Function signs entitlement JWTs with an ES256 private
key. The private key lives in Secret Manager; the public key is embedded in the
app.

**Enable Secret Manager** for the project.

**Generate the keypair — in WSL, not PowerShell** (`openssl` is built into WSL;
the Windows port mangles PEM line endings):

```bash
openssl ecparam -name prime256v1 -genkey -noout
```

Copy the entire `EC PRIVATE KEY` block (including the `BEGIN`/`END` lines).
**Don't** save it to a file or env var — its only home is Secret Manager
(less leak surface: no shell history, no synced drives).

**Upload the private key** — Secret Manager → Create Secret:
- Name: `<product>-entitlement-signing-key-private` (descriptive — you'll have
  many secrets later). *(iDEP: `entitlement-signing-key-private`.)*
- Value: paste the private key block.
- Leave everything else default. **Never set an expiration** — if the signing
  key expires, login breaks.

**Derive + save the public key** — pull the private key back from Secret Manager
(avoids keeping a second copy on disk), pipe through openssl. Run as **two
separate commands** (on one line, bash evaluates `>` before `mkdir` runs):

```bash
mkdir -p ~/<product>-auth-keys
```
```bash
openssl ec -pubout > ~/<product>-auth-keys/<product>-entitlement-public.pem
```

Paste the private key → Enter → Ctrl+D. Verify the output starts with
`-----BEGIN PUBLIC KEY-----`. This public key is safe to commit to the repo —
*(iDEP: committed at `electron/keys/idep-entitlement-public.pem`)*.

## What comes after

GCP console work is done. Next: the product's Stripe account + Free/Pro
products, then the `/entitlement` Cloud Function (repo `idep-functions`), then
the Electron repo wiring. First Cloud Function deploy on a fresh project hits
two IAM gotchas — see [`gcp-iam-cheatsheet.md`](gcp-iam-cheatsheet.md).
