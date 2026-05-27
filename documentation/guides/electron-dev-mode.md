# Electron Desktop App: Dev Mode

Practical guide for iterating on the iDEP Electron shell locally — the window,
splash, auth gate, R spawn, HMAC handshake, port handoff, updater — without
installing the full ~355-package iDEP runtime.

## Two run modes

| Command | What it does | When to use |
|---|---|---|
| `npm start` | Launches Electron and loads the real `idepGolem` package. Requires the full ~10 GB R runtime to be staged. | Reproducing a real iDEP bug end to end. |
| `npm run dev` | Launches Electron with `IDEP_APP=dev` set. `bootstrap.R` loads `idepGolemDev` instead — a tiny diagnostic Shiny app that prints env vars, library paths, and HMAC status. | Iterating on the Electron shell, auth, HMAC, or `bootstrap.R` logic. |

`npm run dev` is the default for everyday development. It needs only R + shiny
+ golem + idepGolemDev (~200 MB total) and starts in seconds.

## One-time setup

Run the platform-appropriate script from `electron/scripts/`. Each downloads
R, stages it under `electron/runtime/`, installs shiny + golem from CRAN, then
installs the `idepGolemDev` package from `electron/idepGolemDev/`.

- **Windows:** `powershell -ExecutionPolicy Bypass -File electron\scripts\get_r_windows.ps1`
- **Linux:** `bash electron/scripts/get_r_linux.sh`
- **macOS:** `bash electron/scripts/get_r_mac.sh`

End result on disk (Windows shown; Linux/Mac equivalent):

```
electron/
├── runtime/
│   └── R.win/                     <- staged R
│       ├── bin/Rscript.exe
│       └── library/
│           ├── shiny/
│           ├── golem/
│           └── idepGolemDev/      <- the diagnostic app
└── idepGolemDev/                  <- source package
```

The dev scripts and the production CI workflows produce the same layout
(`runtime/R.win/`, `runtime/R.linux/`, `runtime/R.framework/`) so `main.js`
finds R the same way in both modes.

## Running

From `electron/`:

```bash
npm install      # once, to pick up cross-env
npm run dev
```

`cross-env` makes the `IDEP_APP=dev` env-var assignment work on Windows, Mac,
and Linux. The script sets the var, then launches Electron. Inside R,
`bootstrap.R` reads `Sys.getenv("IDEP_APP")` and picks `idepGolemDev` instead
of `idepGolem`.

A successful dev launch shows the **iDEP Electron Shell ✓** diagnostic page,
which displays:

- R version and `R.home()`
- Active `.libPaths()`
- Every env var `main.js` passed in (`IDEP_DATA_DIR`, `IDEP_PORT`,
  `SHINY_HMAC_SECRET`, etc.)
- HMAC handshake status (✓ if `SHINY_HMAC_SECRET` was received, ⚠ otherwise)
- Working directory

If the page renders, the entire Electron → R → Shiny → window chain is
working.

## What this does NOT test

- Any iDEP analysis logic — DESeq2, limma, WGCNA, pathway enrichment, etc.
  None of those packages are installed in dev mode. For analysis testing,
  use `npm start` with the full runtime, or build via CI.
- Cross-platform packaging quirks — `electron-builder` is only exercised by
  the CI workflows. Use a tagged release for that.

## Production untouched

The shipped installer is built by `.github/workflows/build-electron-*.yml`,
which uses `electron/scripts/install_packages.R` to install all 355 packages
into the production layout. The dev scripts in `electron/scripts/get_r_*` are
separate and *do not run* `install_packages.R` — they are dev-only and never
ship.

`IDEP_APP=dev` is the only signal that switches `bootstrap.R` between the two
app packages. End-user launches never set it, so they always load the real
`idepGolem`.

## Architecture cross-references

- `electron/main.js` — the Electron main process. `getRuntime()` locates the
  bundled R runtime; `spawnR()` launches `bootstrap.R`.
- `electron/bootstrap.R` — R-side launch entry. Reads env vars, sets library
  paths, then loads `idepGolem` or `idepGolemDev` based on `IDEP_APP`.
- `electron/idepGolemDev/` — the diagnostic Golem-shaped Shiny package.
- `documentation/architecture/overview.md` — full system architecture
  (three layers, end-to-end launch flow).
