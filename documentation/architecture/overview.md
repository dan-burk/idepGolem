# Architecture Overview

This is the map. Read it first; it explains what the moving parts are and how a
launch flows end to end. Unfamiliar terms are defined in
[`../glossary.md`](../glossary.md).

## What iDEP is

iDEP (Integrated Differential Expression & Pathway analysis) is a bioinformatics
platform for analyzing gene-expression data. The same analysis code ships in two
forms:

1. As a **web application** (the original delivery — run on a server, used in a
   browser, or via the Docker image).
2. As a **desktop application** for Windows, macOS, and Linux — the same web app,
   wrapped so it runs entirely on the user's own machine with no server.

Most of this documentation is about the desktop form, because that's where the
extra machinery lives.

## The three layers

The desktop app is three layers stacked together:

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 3 — Auth & entitlement backend  (Google Cloud)          │
│  • Google OAuth (who is this user?)                            │
│  • /entitlement cloud function (is this user licensed?)        │
│  • Secret Manager (holds the signing key)                      │
└───────────────▲────────────────────────────────────────────────┘
                │  sign in (PKCE) + fetch signed entitlement (JWT)
┌───────────────┴────────────────────────────────────────────────┐
│  LAYER 2 — Desktop shell  (Electron — electron/main.js)         │
│  • draws the window + splash screen                            │
│  • runs the auth gate, then spawns R                           │
│  • bundles a complete R runtime so the user needs nothing      │
└───────────────▲────────────────────────────────────────────────┘
                │  spawn Rscript bootstrap.R   +   HMAC-signed HTTP
┌───────────────┴────────────────────────────────────────────────┐
│  LAYER 1 — The analysis app  (R / Shiny — the idepGolem package)│
│  • a Golem Shiny app, 12 analysis modules                      │
│  • this is the actual science; identical to the web version    │
└──────────────────────────────────────────────────────────────┘
```

The key mental model: **Layer 1 is the product.** Layers 2 and 3 exist only to
deliver Layer 1 to a user's desktop and to control who may run it. If you
deleted Layers 2 and 3, the Shiny app would still run — that's exactly what the
web/Docker deployment is.

---

## Layer 1 — The analysis app (R / Shiny)

The analysis app is an R package called **`idepGolem`**, built with the **Golem**
framework. Golem means it's a proper R package (it has a `DESCRIPTION`, an `R/`
folder, tests) that happens to contain a **Shiny** web app.

- **Entry point:** `R/run_app.R` exports `run_app()`, which returns a running
  Shiny application.
- **Structure:** the app is split into **12 modules**, one per analysis stage —
  `mod_01_load_data` through `mod_12_heatmap`. Each module is a `mod_XX_*.R`
  file (UI + server) paired with a `fct_XX_*.R` file (the analysis functions).
- **Data flow:** modules hand data to each other as **reactive expressions** —
  load → preprocess → clustering / PCA / DEG / pathway / …. Change an input
  upstream and everything downstream recomputes automatically.
- **Database:** species and pathway data come from a versioned database
  (`db_ver`, currently `data113`), located via the `IDEP_DATABASE` environment
  variable.

For desktop use this package is **compiled and installed into the bundled R
runtime** during the build — it is not run from source.

> Deeper detail (the 12 modules, the reactive graph) will live in
> `architecture/shiny-app.md`.

---

## Layer 2 — The desktop shell (Electron)

The desktop shell is an **Electron** app in `electron/`. Its job is to turn "an
R/Shiny app" into "a thing a non-technical user double-clicks."

It does three things:

**1. It bundles everything the app needs.** The user is not expected to have R
installed. The installer therefore contains a **complete R runtime plus all
~355 R packages** (`electron/runtime/`), the compiled `idepGolem` package, and
the Electron shell itself. This is why the installers are large (~1–2 GB).

**2. It runs the auth gate** (see Layer 3) before any analysis starts. If the
user isn't signed in and entitled, the app shows an error and quits.

**3. It launches and supervises R.** `electron/main.js` (the Electron *main
process*):
- shows `splash.html` immediately so the user sees something while R boots;
- locates the bundled R runtime via `process.resourcesPath`;
- spawns `Rscript bootstrap.R` as a child process;
- `electron/bootstrap.R` sets the library path, loads `idepGolem`, and calls
  `run_app()` to start the Shiny server on a local port (127.0.0.1);
- `main.js` waits for Shiny to report "Listening on…", then loads that local
  URL into the window.

It also runs the **in-app updater** (`electron/updater.js`): on startup it asks
GitHub for the latest release and, if newer, offers the user a download link.

> Deeper detail (the launch state machine, runtime bundling, `files` vs
> `extraResources`) will live in `architecture/desktop-app.md`.

---

## Layer 3 — Auth & entitlement (Google Cloud)

Layer 3 exists for one business reason: iDEP's **Free / Pro / Enterprise**
monetization model. To charge for tiers, the app has to know who a user is and
what they've paid for — and it has to do that before the analysis starts. This
layer is the foundation; the actual tier-gating of features is still to be
built.

Before the analysis app starts, the desktop shell proves two things:

1. **Who the user is** — via **Google OAuth 2.0** using the **Authorization
   Code + PKCE** flow. The shell opens a browser, the user signs in with Google,
   and the shell receives tokens proving the identity. PKCE is used because a
   desktop app cannot keep a client secret safe.

2. **That the user is licensed** — the shell calls iDEP's **`/entitlement`**
   cloud function, which checks the user and returns a signed **entitlement
   JWT**. The function signs it with a private key kept in Google **Secret
   Manager**; the shell verifies the signature with the matching public key.

The verified entitlement is cached locally with Electron's `safeStorage` (OS-
encrypted) so the user doesn't sign in every launch.

Finally, there's an **internal** handshake between the shell and Shiny. Because
the Shiny server listens on a local HTTP port, *any* program on the machine
could talk to it. To prevent that, the shell generates a random secret at
launch, passes it to R via the `SHINY_HMAC_SECRET` environment variable, and
**HMAC-signs every request** to Shiny with a per-session JWT. Shiny (via
`R/auth_helpers.R`) rejects any request not carrying a valid signature.

`IDEP_AUTH_DISABLED=1` bypasses all of Layer 3 — an emergency/dev escape hatch.

> Full detail — the 9-step flow, the two-JWT design, every component, deployed
> coordinates — is in [`auth-and-entitlement.md`](auth-and-entitlement.md).

---

## The build & release pipeline

The three installers are built by **GitHub Actions**, one workflow per OS in
`.github/workflows/`:

- `build-electron-windows.yml` → `.exe`
- `build-electron-linux.yml` → `.deb`
- `build-electron-mac.yml` → `.dmg`

Each workflow does the same shape of work: set up R and Node, stage a full R
runtime into `electron/runtime/`, install all R packages from a **PPM snapshot**
(for reproducibility), compile and install `idepGolem`, then run
`electron-builder` to produce the installer and publish it to a GitHub Release.

Releases are **tag-driven**: pushing a `desktop-v*` git tag triggers all three
builds. The version in `electron/package.json` is the single source of truth and
the tag must match it — `npm version` keeps them in sync, and CI fails fast if
they disagree. See the root `README.md` for the exact release commands.

> Deeper detail will live in `architecture/build-and-release.md`.

---

## End to end: what happens on launch

Putting all three layers together — a user double-clicks the installed app:

1. **Electron starts** and shows the splash screen.
2. **Auth gate (Layer 3):** the shell checks `safeStorage` for a cached, valid
   entitlement. If none, it runs Google sign-in (OAuth + PKCE) and fetches a
   fresh entitlement JWT from `/entitlement`, verifying its signature. On
   failure → error dialog, quit.
3. **The shell generates the HMAC secret** for the upcoming Shiny handshake.
4. **The shell locates the bundled R runtime** and spawns
   `Rscript bootstrap.R`, passing configuration (data dir, port, HMAC secret)
   as environment variables.
5. **`bootstrap.R` runs (Layer 1):** sets library paths, loads `idepGolem`,
   calls `run_app()`, and starts the Shiny server on `127.0.0.1:<port>`.
6. **The shell waits** for Shiny's "Listening on…" message, then loads that
   local URL into the Electron window — now showing the real iDEP UI.
7. **Every HTTP request** from the window to Shiny carries an HMAC-signed JWT;
   Shiny verifies it.
8. **In the background**, the updater asks GitHub for a newer release.

From the user's point of view this is just "the app opened." Everything above is
invisible — which is the whole point of Layer 2.

---

## Where to go next

- Terminology you didn't recognize → [`../glossary.md`](../glossary.md)
- Practical how-tos (packaging, platform builds) → [`../guides/`](../guides/)
- Historical context on past fixes/decisions → [`../notes/`](../notes/)
