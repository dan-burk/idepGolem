# Why We Changed the Electron Build

## 1. R Version Alignment

**Situation:** Electron build used R 4.4.1 in CI, 4.4.2 in Windows script, 4.5.2 in Mac script — three versions across one project.
**Task:** Match production iDEP, which runs R 4.5.1, and eliminate version drift.
**Action:** Pinned all CI workflows and standalone scripts to R 4.5.1 / Rtools 45.
**Result:** Single R version across all platforms and build paths.

## 2. Electron / Node / electron-builder Stack Outdated

**Situation:** Electron 31.7.7 was EOL before the code was even delivered (Nov 2025). Node 20 was in maintenance mode. electron-builder had a version mismatch — package.json said 24.13.3, CI force-installed 26.0.12.
**Task:** Move to supported, maintained versions with consistent tooling.
**Action:** Upgraded to Electron 39, Node 22 (active LTS), electron-builder 26.8.2 (consistent in both package.json and CI).
**Result:** Entire stack on supported versions; no mismatch between local and CI builds.

## 3. No Reproducible Package Snapshots

**Situation:** No mechanism to lock R package versions to a known-working set. Each build pulled latest, risking silent breakage.
**Task:** Achieve reproducible installs without runtime version drift.
**Action:** Adopted Posit Package Manager (PPM) date-based snapshots (CRAN + Bioconductor). Attempted renv first — failed due to renv 1.2.0 bugs.
**Result:** Builds install the exact same package versions every time, pinned to a specific snapshot date.

## 4. Hardcoded Package Lists → Single Source of Truth

**Situation:** Each workflow had its own hardcoded CRAN/Bioc split list. Windows was missing 7 Bioconductor packages. Lists drifted from DESCRIPTION.
**Task:** One place to declare dependencies, read by all build paths.
**Action:** Replaced ~150 lines of inline install logic per workflow with a single shared `install_packages.R` that reads DESCRIPTION.
**Result:** DESCRIPTION is the single source of truth. Adding/removing a dependency requires editing one file, not three workflows.

## 5. biocViews Not a Dependency Field

**Situation:** Bioconductor packages were listed under `biocViews` in DESCRIPTION, which is a categorization taxonomy — not a dependency field. No installer (devtools, pak, install.packages) reads it.
**Task:** Ensure all Bioconductor dependencies are actually installed.
**Action:** Moved all Bioconductor packages from `biocViews` to `Imports`.
**Result:** All 18 org.*.db annotation databases and Bioc dependencies are now properly declared and installed.

## 6. devtools → pak

**Situation:** devtools 2.5.0 formally deprecated all `install_*` functions and recommends pak as the replacement.
**Task:** Use the officially recommended tool for R package installation.
**Action:** Switched to `pak::local_install_deps()`, which natively handles CRAN, Bioconductor, and Remotes (GitHub, archive URLs) from DESCRIPTION.
**Result:** Single function call replaces separate `install.packages()` + `BiocManager::install()` + `devtools::install_deps()` calls.

## 7. Broken and Dead Code Cleanup

**Situation:** `get_r_linux.sh` crashed at line 27. A duplicate Windows workflow in `workflows/` (not `.github/workflows/`) was dead code GitHub never executed. `undici` was a redundant dependency (Node 20+ has built-in fetch).
**Task:** Remove non-functional and misleading code.
**Action:** Fixed `get_r_linux.sh` into a legitimate script. Identified dead workflow for removal. Removed undici dependency.
**Result:** No dead code masquerading as functional; no redundant dependencies.

## 8. Platform Build Asymmetry

**Situation:** Windows build missing 7 Bioconductor packages vs Linux/Mac. Mac patched DESCRIPTION to remove ggalt. GSVA marked optional only on Linux. Archived packages (biclust, PGSEA, KEGG.db) had no install logic on any platform.
**Task:** All platforms should produce functionally equivalent builds.
**Action:** Shared `install_packages.R` handles all packages uniformly across Linux and Windows. Archived packages installed via Remotes in DESCRIPTION.
**Result:** Linux and Windows builds now install identical package sets. Mac workflow pending migration.

## 9. Bootstrap Set CWD to Read-Only App Directory

**Situation:** The bootstrap script ran `setwd(app_dir)`, pointing R's working directory at the read-only install location (`/opt/iDEP/resources/app` on Linux, `...\resources\app` on Windows). The R source code downloads and extracts the database relative to CWD, so all writes failed with "Permission denied" on Linux. Masked on Windows where the install directory happened to be writable.
**Task:** Point CWD at a writable directory without modifying R source code.
**Action:** Changed `setwd(app_dir)` to `setwd(data_dir)` in the bootstrap. `data_dir` is the writable user data directory that `main.js` already creates. Nothing in the R package requires CWD to be the app directory — Golem uses `app_sys()`, packages load via `.libPaths()`.
**Result:** First-launch database download succeeds on all platforms. Zero R source changes — Electron fix stays in Electron.

## 10. Stale Port File Causes Timeout on Relaunch

**Situation:** R writes its port number to `idep_port.txt` during startup. On relaunch, `main.js` found the port file from the previous session immediately, read the old port, and committed to it before R had a chance to start and write the new port. If Shiny bound to a different port (because the old one was still in TIME_WAIT), `main.js` waited on the wrong port and timed out after 120 seconds.
**Task:** Ensure `main.js` always connects to the port Shiny actually binds to.
**Action:** Delete `idep_port.txt` before spawning R so the port file loop waits for R to write a fresh value.
**Result:** Relaunch correctly detects the new port. No more timeout on second run.

## 11. Linux Build Produced Redundant Artifacts

**Situation:** electron-builder was configured to produce both `.AppImage` and `.deb` targets for Linux, plus the `linux-unpacked/` directory. The GitHub Actions artifact (linux-dist.zip) contained all three — roughly 12.5G — even though only one format is needed for distribution.
**Task:** Reduce artifact size by building only the distribution format we actually ship.
**Action:** Removed `"AppImage"` from the `linux.target` array in `electron/package.json`, keeping only `"deb"`. Changed the GitHub Actions upload step in `build-electron-linux.yml` to upload only `dist/*.deb` (instead of `dist/**`) and renamed the artifact from `linux-dist` to `linux-installer`.
**Result:** Linux build produces only the `.deb` installer (~2G), cutting the artifact size by ~10G. The downloaded artifact contains just the installer — no debug logs, update manifests, or unpacked directories.

## 12. Inline R Bootstrap and HTML Extracted to Standalone Files

**Situation:** `main.js` contained a 138-line R bootstrap script inside a JavaScript template literal and a 45-line splash screen as inline HTML. The R code had no syntax highlighting, no linting, required JS-style escaping (`\\n` instead of `\n`), and couldn't be tested independently. Any edit to the R logic required working inside a JS string, making changes error-prone.
**Task:** Separate concerns so R code lives in `.R` files and HTML lives in `.html` files, while keeping `main.js` focused on orchestration.
**Action:** Extracted the bootstrap to `electron/bootstrap.R` and the splash screen to `electron/splash.html`. The R script was already reading all config from environment variables (`IDEP_DATA_DIR`, `IDEP_PORT`, etc.) set by `main.js` at spawn time, so the JS template interpolation was unnecessary. The splash HTML uses a single `{{LOG_FILE}}` placeholder replaced at load time. Added both files to the `files` array in `package.json` so electron-builder includes them in the build.
**Result:** `main.js` dropped from 603 to 433 lines. `bootstrap.R` gets proper R editor support and can be tested standalone via `Rscript bootstrap.R` with the right env vars. No runtime file generation — `main.js` no longer writes the bootstrap to disk on every launch.

## 13. waitForHttp Silently Aborting Requests After 2 Seconds

**Situation:** `waitForHttp` in `main.js` used an `AbortController` that killed each `fetch()` attempt after 2 seconds (`Math.min(5000, intervalMs * 4)` with `intervalMs = 500`). The Shiny app has 12 modules and loads bioinformatics databases — its first HTTP response can take 10-30 seconds to render. Every attempt was aborted before Shiny could respond. The `catch {}` block silently swallowed the `AbortError`, so logs showed nothing. The outer timeout was also reduced from 120s to 30s in a prior commit, compounding the problem. Additionally, the status check only accepted HTTP 200/404/403, silently retrying on any other status (e.g., 500 during heavy startup).
**Task:** Allow enough time for Shiny's first response and make failures visible.
**Action:** Increased per-request abort timeout from 2s to 30s. Restored outer timeout from 30s to 120s. Changed status check to accept any HTTP response as proof the server is alive. Added error logging to the catch block (logs error name and message on first 3 attempts and every 10th attempt thereafter).
**Result:** `waitForHttp` now patiently waits for Shiny's first response instead of aborting it. Failures are visible in `/tmp/idep-electron.log` instead of silently swallowed.
