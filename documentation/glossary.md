# Glossary

Plain-English definitions of the concepts and jargon used across the iDEP
codebase. Each entry says what the term means *in general* and then how it is
used *in iDEP specifically*.

Sections:
[Authentication & security](#authentication--security) ·
[The desktop app (Electron)](#the-desktop-app-electron) ·
[The analysis app (R / Shiny)](#the-analysis-app-r--shiny) ·
[Build & release](#build--release)

---

## Authentication & security

iDEP's desktop app makes the user sign in with Google and checks they are
allowed to use the app, before the analysis even starts. These terms describe
how that works.

### Authentication vs. authorization
Two different questions, often confused:
- **Authentication** — *"who are you?"* Proving identity. iDEP answers this with
  Google sign-in.
- **Authorization** — *"are you allowed to do this?"* Proving permission. iDEP
  answers this with the **entitlement** check.

### OAuth 2.0
An industry-standard protocol that lets an app verify a user's identity through
a third party (here, Google) **without the app ever seeing the user's
password**. The app instead receives short-lived **tokens** from Google that
prove the user signed in. iDEP uses OAuth 2.0 so it can say "this user is
`alice@gmail.com`" without ever handling Google passwords.

### Authorization Code flow / PKCE
The *specific variant* of OAuth 2.0 that iDEP uses. The app opens a browser,
the user logs into Google, Google hands back a one-time **authorization code**,
and the app exchanges that code for tokens.

**PKCE** (Proof Key for Code Exchange, pronounced "pixie") is a security
add-on for that flow, designed for apps that can't keep a secret safely — like
a desktop app whose files anyone can inspect. The app invents a random secret
("code verifier") at the start, sends only a *hash* of it to Google, and must
present the original to redeem the code. This stops an attacker who intercepts
the authorization code from using it, because they don't have the verifier.
iDEP's desktop app is exactly this case, so it uses Authorization Code + PKCE.

### Loopback redirect
How a desktop app receives the result of an OAuth login. A desktop app has no
web address for Google to redirect back to, so it starts a tiny HTTP server on
`http://127.0.0.1:<random-port>` and tells Google to redirect *there*. Defined
by RFC 8252. Google's "Desktop app" OAuth client type expects exactly this.
(Embedded browser windows are **banned** by Google since 2023 — desktop auth
must open the user's real system browser.)

### ID token / access token / refresh token
The three tokens Google returns after a successful login:
- **ID token** — a JWT proving *who the user is* (email, etc.). iDEP forwards
  this to its `/entitlement` function.
- **Access token** — lets the app call Google APIs on the user's behalf.
- **Refresh token** — lets the app silently obtain fresh tokens later without
  making the user log in again.

### JWKS (JSON Web Key Set)
A public URL where a token issuer (e.g. Google) publishes its public keys, so
anyone can verify tokens that issuer signed. iDEP's `/entitlement` function
verifies Google ID tokens against Google's JWKS.

### Token
A piece of data that proves something so the holder doesn't have to re-prove it
every time. Like a wristband at an event: checked once at the gate, then trusted.
OAuth produces several tokens; the one iDEP cares most about is wrapped inside
the **entitlement** (a JWT, below).

### JWT (JSON Web Token)
**The single most important term to understand.** A JWT is a small, self-contained
token with three parts, separated by dots:

```
   header  .  payload  .  signature
   eyJhbG  .  eyJzdWI  .  TJVA95Or...
```

- **Header** — metadata: what algorithm signed this.
- **Payload** — the actual facts being asserted, called **claims** — e.g.
  "user = alice@gmail.com", "tier = pro", "expires = 2026-06-01". This part is
  just Base64-encoded JSON: **not encrypted, anyone can read it.**
- **Signature** — a cryptographic stamp over the header + payload, created with
  a secret key. This is the point of a JWT: a recipient can **verify the
  signature** and know the payload was created by someone holding the key and
  **has not been tampered with**. If someone edits the payload to say
  "tier = enterprise", the signature no longer matches and verification fails.

A JWT is *tamper-evident*, not *secret*. It answers "can I trust this data?"
not "can I hide this data?"

iDEP uses JWTs in **two** places:
1. **The entitlement JWT** — issued by iDEP's `/entitlement` server, signed with
   iDEP's private key, asserting the user is a paying/allowed user. The desktop
   app verifies it with iDEP's public key.
2. **The per-session JWT to Shiny** — the Electron shell mints a JWT on every
   request to the local R/Shiny server so Shiny knows the request really came
   from the trusted shell and not from some other program on the machine.

### Claims
The individual facts inside a JWT's payload (user id, tier, expiry, …). "The
token's claims" = "what the token asserts."

### Signature / signing / verifying
- **Signing** — using a *private* key to produce the cryptographic stamp on data.
- **Verifying** — using the matching *public* key to confirm a stamp is genuine.
- Only the holder of the private key can sign; anyone with the public key can
  verify. This is **asymmetric** cryptography (key pair: one private, one public).

### HMAC
A different, **symmetric** way to stamp data: the *same* secret key both creates
and checks the stamp. Simpler and faster than asymmetric signing, but both sides
must share the one secret.

iDEP uses HMAC for the **Electron → Shiny handshake**. The Electron shell
generates a random secret at launch, passes it to the R process via the
`SHINY_HMAC_SECRET` environment variable, and then HMAC-signs every request to
the local Shiny server. Shiny checks the HMAC with the same secret. Because the
secret only lives in those two cooperating processes, Shiny can reject any HTTP
request that didn't come from the shell — e.g. another app on the machine
poking at the local port.

### Entitlement
iDEP-specific term: a signed statement that **a given user is allowed to run
the app** (and at what tier). It's delivered as a JWT from iDEP's `/entitlement`
cloud function. The desktop app fetches it after Google sign-in, verifies its
signature, and caches it. "Checking entitlement" = "confirming this user is
licensed."

### Bearer token
A token sent in an HTTP request's `Authorization: Bearer <token>` header.
"Bearer" means *whoever holds it can use it* (no extra proof of identity), so
bearer tokens must be kept private. iDEP attaches the per-session JWT to local
Shiny requests this way.

### `safeStorage`
An Electron API that encrypts data using the operating system's secure store
(Keychain on macOS, DPAPI on Windows). iDEP uses it to cache the verified
entitlement on disk so the user doesn't have to sign in every launch — without
leaving the entitlement readable as plain text.

### Secret Manager
A Google Cloud service that stores secrets (like iDEP's entitlement-signing
private key) encrypted and access-controlled, instead of in source code. The
`/entitlement` cloud function reads the signing key from Secret Manager.

### Code signing (and "ad-hoc" signing)
Attaching a cryptographic signature to an application so the operating system
can confirm who built it and that it hasn't been altered.
- **Proper signing** needs a paid Apple Developer certificate.
- **Ad-hoc signing** is a signature with *no identity* attached. It satisfies
  the OS's structural requirements but doesn't prove a publisher. iDEP's macOS
  build currently uses ad-hoc signing — which is why first launch shows a
  Gatekeeper warning the user must click through.

### Notarization / Gatekeeper / hardened runtime (macOS)
- **Gatekeeper** — the macOS feature that blocks apps from unidentified
  developers on first launch.
- **Notarization** — submitting the app to Apple, which scans it for malware
  and issues a "ticket"; a notarized app launches without scary warnings.
  iDEP is **not** notarized yet (it needs a paid Apple Developer account); the
  workflow keeps the steps stubbed out for when one is available.
- **Hardened runtime** — a macOS security mode that restricts what an app can
  do (and is a prerequisite for notarization). iDEP's build enables it.
- **Entitlements (`.plist`)** — on macOS, a list of exceptions to the hardened
  runtime's restrictions (e.g. "this app is allowed to run a child process").
  Lives in `electron/entitlements.mac.plist`. *Note:* "entitlement" here is an
  Apple OS term — unrelated to iDEP's licensing "entitlement" above. Same word,
  two worlds.

---

## The desktop app (Electron)

### Electron
A framework for building desktop apps using web technology (HTML/JS) plus a
bundled copy of Chromium and Node.js. iDEP uses Electron as a **shell**: it
draws the window, then launches R/Shiny as a child process and displays it.

### Main process vs. renderer process
- **Main process** — the Node.js side of an Electron app; it controls windows,
  the menu, child processes, the filesystem. iDEP's `electron/main.js` is this.
- **Renderer process** — the Chromium side; it draws web content in a window.
  For iDEP the renderer just shows the splash screen and then the Shiny UI.

### electron-builder
The tool that packages the Electron app into a real installer for each OS — a
`.dmg` (macOS), an `.exe` (Windows), a `.deb` (Linux). Configured under the
`build` key of `electron/package.json`.

### `.app` bundle / `.dmg` / `.exe` / `.deb`
- **`.app`** — on macOS, an application is actually a folder (a "bundle") that
  looks like a single icon.
- **`.dmg`** — a macOS disk image; the standard way to ship a `.app`. The user
  opens it and drags the app to Applications.
- **`.exe`** (built via **NSIS**, a Windows installer system) — the Windows
  installer.
- **`.deb`** — the package format for Debian/Ubuntu Linux.

### asar
An Electron archive format that bundles an app's files into one blob. iDEP sets
`asar: false` because it bundles a large R runtime that must stay as ordinary
files on disk for R to execute.

### `files` vs. `extraResources`
Two separate lists in electron-builder config controlling what goes into the
installer:
- **`files`** — the application payload (the JS code), placed inside the app.
- **`extraResources`** — side-car files copied next to the app, reached at
  runtime via `process.resourcesPath`.

iDEP delivers the R runtime through `extraResources`. (Historically it was
listed in *both*, which silently bundled the multi-gigabyte runtime twice — see
`notes/` and the build docs.)

### `process.resourcesPath`
A path, available to a packaged Electron app, pointing at its resources folder.
iDEP's `main.js` finds the bundled R runtime relative to this path.

### `app.getVersion()`
An Electron call that returns the app's version — read from the bundled
`package.json`'s `version` field. iDEP's in-app updater compares this against
the latest GitHub release.

### R runtime / `R.framework`
iDEP's desktop app does not assume the user has R installed — it **bundles a
complete R interpreter and all ~355 packages** inside the installer. On macOS
that bundle is an `R.framework`; on Windows/Linux it's an `R.win` / `R.linux`
folder. This is why the installers are large.

### `bootstrap.R`
The R script the Electron shell runs to start the analysis app. It sets library
paths, loads the `idepGolem` package, and calls `run_app()` to start the Shiny
server. Lives at `electron/bootstrap.R`.

### Splash screen
The window shown while the app is starting (R can take 10–30 s to boot). iDEP's
is `electron/splash.html`, updated with progress messages by `main.js`.

---

## The analysis app (R / Shiny)

### R
A programming language and environment for statistics and data analysis. iDEP's
actual science — differential expression, pathway analysis — is written in R.

### Shiny
An R framework for building interactive web applications entirely in R. iDEP's
user interface is a Shiny app.

### Shiny module
A reusable, self-contained piece of a Shiny app — its own UI + server logic
with a private namespace, so two instances don't collide. iDEP is split into 12
modules (`mod_01_load_data` … `mod_12_heatmap`), one per analysis stage.

### Reactive expression
The core idea of Shiny: a value that **automatically recomputes when its inputs
change**, and anything depending on it updates in turn — like a spreadsheet
cell. iDEP passes data between modules as reactive expressions, so changing the
loaded data flows through clustering, PCA, etc. without manual wiring.

### Golem
An R framework for building **production-grade** Shiny apps as proper R
packages — with a fixed structure, configuration, and testing conventions.
iDEP is a Golem app: that's why it has a `DESCRIPTION`, an `R/` folder of
`mod_*` / `fct_*` files, and is installed like a library.

### R package / `DESCRIPTION`
An R package is the standard unit for shipping R code. Its `DESCRIPTION` file
lists metadata and dependencies. iDEP *is* an R package named `idepGolem`; the
desktop build compiles it and installs it into the bundled runtime.

### CRAN / Bioconductor
The two main repositories of R packages. **CRAN** is general-purpose;
**Bioconductor** specializes in bioinformatics (iDEP depends on many of these:
DESeq2, limma, …).

### PPM snapshot
**Posit Package Manager** snapshots — pinned, dated views of CRAN/Bioconductor.
Building against a snapshot means every build installs the *same* package
versions, instead of whatever happens to be newest that day. iDEP's CI uses PPM
snapshots for reproducible builds.

---

## Build & release

### GitHub Actions / workflow / runner
- **GitHub Actions** — GitHub's built-in automation system.
- **Workflow** — a YAML file in `.github/workflows/` describing a job to run
  automatically (iDEP has one per OS for the desktop builds).
- **Runner** — the temporary virtual machine GitHub provides to execute a
  workflow. Each iDEP build runs on a fresh macOS / Windows / Linux runner.

### Artifact
A file produced by a workflow and stored by GitHub for later download. Separate
from a **release**: an artifact is a build output kept temporarily; a release
asset is published permanently.

### Git tag
A named marker pointing at a specific commit, used to mark releases. iDEP's
desktop releases use tags prefixed `desktop-v` (e.g. `desktop-v1.0.3`). Pushing
such a tag triggers the build workflows.

### Semantic versioning (semver)
The `MAJOR.MINOR.PATCH` version scheme (e.g. `1.0.3`):
- **PATCH** — backwards-compatible fixes,
- **MINOR** — backwards-compatible new features,
- **MAJOR** — breaking changes.

`npm version patch|minor|major` bumps the right number, commits, and tags — see
the release instructions in the root `README.md`.

### GitHub Release
A published, permanent bundle attached to a tag, with downloadable assets (the
installers). iDEP's in-app updater checks the *latest* release to decide whether
to prompt the user to update.
