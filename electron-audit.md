# Electron Setup Audit

**Author:** Daniel Burkhalter (with Claude)
**Date:** 2026-03-26
**Subject:** Audit of Electron packaging work by raghaviCJanaswamy
**Commit under review:** `74d7cf3` (2025-11-29) "Electron Packaging for Widows and MAC"

---

## Summary

All Electron work was delivered in a single commit. This audit documents every anomaly,
inconsistency, and questionable decision found. Each item has a **Question** (for the
contractor) and a **Verdict** column to be filled in after discussion.

---

## 1. R Version Inconsistencies

The single biggest red flag. Three different R versions are used across the build system
with no documentation explaining why.

| Location | R Version | File |
|----------|-----------|------|
| GitHub Actions - Linux | 4.4.1 | `build-electron-linux.yml:116` |
| GitHub Actions - Mac | 4.4.1 | `build-electron-mac.yml:107` |
| GitHub Actions - Windows | 4.4.1 | `build-electron-windows.yml:112` |
| `get_r_linux.sh` (standalone script) | 4.4.1 | `electron/scripts/get_r_linux.sh:3` |
| `get_r_windows.ps1` (standalone script) | 4.4.2 | `electron/scripts/get_r_windows.ps1:6` |
| `get_r_mac.sh` (standalone script) | 4.5.2 | `electron/scripts/get_r_mac.sh:5` |

**Question:** Why are there three different R versions? The workflows all use 4.4.1, but the
standalone scripts use 4.4.1, 4.4.2, and 4.5.2 respectively. Was this intentional? If the
standalone scripts are meant for local builds, why do they diverge from CI?

**Risk:** If anyone uses `get_r_windows.ps1` or `get_r_mac.sh` directly (instead of CI),
they get a different R version than CI produces. Packages compiled under 4.5.x may not
work on 4.4.x.

**Verdict:** _TBD_
**Changes:** We converged everything to R version 4.5.1 (R Tools to 45 for Windows)

---

## 2. Duplicate Workflow File

There are TWO Windows workflow files:

| File | Location | Trigger |
|------|----------|---------|
| `.github/workflows/build-electron-windows.yml` | Standard location | `workflow_dispatch` only (push triggers commented out) |
| `workflows/build-electron-windows.yml` | Non-standard location | `workflow_dispatch` + push on `packaging1`/`rel*` branches |

The one in `workflows/` (non-standard path) has active push triggers. GitHub Actions only
reads from `.github/workflows/`, so the `workflows/` copy is **dead code that looks active**.

**Question:** Why is there a duplicate? Was this a copy-paste mistake, or was there an
intent to have a "dev" vs "prod" version? The `workflows/` version will never execute.

**Risk:** Someone could edit the wrong file thinking they're updating the active workflow.

**Verdict:** _TBD_
**Changes:** We are planning on removing that folder as dead code, but haven't yet.

---

## 3. `get_r_linux.sh` is Broken / Not a Real Script

This file (`electron/scripts/get_r_linux.sh`) has serious problems:

- **Lines 1-19:** Legitimate bash script that downloads R source and compiles from source
  (unusual choice vs. using a prebuilt binary)
- **Lines 21-61:** Junk appended after the script. Starting at line 27, there is literal
  text `----------- DEV ONLY testing` followed by an R script (`fetch_db.R`) and usage
  instructions pasted directly into the shell script.

```
# Line 27 onwards:
----------- DEV ONLY testing

a) fetch DB
#!/usr/bin/env Rscript
# fetch_db.R -- optional helper for dev/admin use
...
```

This means `get_r_linux.sh` will **crash at line 27** if anyone runs it because
`----------- DEV ONLY testing` is not valid bash syntax (with `set -euo pipefail` on).

**Question:** Was this script ever actually run? It appears to be a draft with notes
pasted in. The CI workflow doesn't use this script at all (it uses `r-lib/actions/setup-r`
+ rsync instead). Why was it committed in this state?

**Also:** The script compiles R from source (`./configure && make`), which takes 15-20
minutes on CI and requires build dependencies. The Mac and Windows scripts download
prebuilt binaries. Why the asymmetry?

**Risk:** The script is non-functional. If someone tries to use it for a local Linux build
it will fail.

**Verdict:** _TBD_
**Changes:** We made it into a legitimate testing script

---

## 4. Hardcoded Bioconductor Package List

All three workflows hand-roll package installation by splitting packages into a hardcoded
CRAN vs Bioconductor list instead of using `devtools::install_deps()` or `BiocManager::repositories()`.

The hardcoded Bioc list varies by platform:

**Linux/Mac** (`build-electron-linux.yml:249`, `build-electron-mac.yml:270`):
```r
c("DESeq2","edgeR","ComplexHeatmap","GSVA","gage",
  "hgu133plus2.db","InteractiveComplexHeatmap","PCAtools",
  "pathview","QUBIC","fgsea","WGCNA",
  "GO.db","SummarizedExperiment","Biobase",
  "limma","KEGGREST","preprocessCore")
```

**Windows** (`build-electron-windows.yml:184`):
```r
c("DESeq2","edgeR","ComplexHeatmap","GSVA","gage",
  "hgu133plus2.db","InteractiveComplexHeatmap",
  "PCAtools","pathview","QUBIC","fgsea")
```

**Missing from Windows that Linux/Mac have:**
- `WGCNA`
- `GO.db`
- `SummarizedExperiment`
- `Biobase`
- `limma`
- `KEGGREST`
- `preprocessCore`

**Question:** Why does the Windows build have a shorter Bioc list? These are core packages
that the app needs. Were they excluded because of build issues on Windows, or was this an
oversight from copy-pasting?

**Risk:** The Windows Electron app may fail at runtime when features that need `limma`,
`WGCNA`, or other missing packages are used. They *might* get pulled in as transitive
dependencies of `DESeq2`/`edgeR`, but this is fragile and undocumented.

**Deep dive:** See [electron-dependency-audit.md](electron-dependency-audit.md) for a full analysis of
which packages fall through the cracks, including Bioc packages missing from the hardcoded
list, all 18 `org.*.db` annotation databases, archived packages with no special handling,
and fix strategies.

**Verdict:** _TBD_
**Changes:** Attempted renv.lock approach first — failed due to renv 1.2.0 bugs (see
`renv-bug-report.md`). Replaced with Posit Package Manager (PPM) date-based snapshots.
Linux and Windows now use a single shared `electron/scripts/install_packages.R` that
installs all packages from PPM snapshots (CRAN: 2026-03-31, Bioconductor: 2025-10-17).
This eliminated ~150 lines of hardcoded install logic from each workflow.
**Mac workflow is still on the old approach** — uses its own inline install logic with a
shorter/different package list. Mac excludes packages that Linux/Windows now install (see
items #15, #14). Mac workflow left untouched intentionally for comparison before migration.
**Ask original developer:** Mac is also missing `ReactomePA`, `runibic`, and 3 archived
packages (`biclust`, `PGSEA`, `KEGG.db`) that have no install logic at all. Were the
features using these packages tested on Mac, or were they dropped because they failed to
build? The archived packages silently fail — they wouldn't produce a build error.

---

## 5. `electron-builder` Version Mismatch

| Location | Version |
|----------|---------|
| `package.json` devDependencies | `24.13.3` |
| Workflow "Ensure electron-builder present" step | `26.0.12` |

The workflows check for `electron-builder@26.0.12` and install it if not found, but
`package.json` locks to `24.13.3`. This means:

1. `npm ci` installs v24
2. The "ensure" step may or may not override it to v26 depending on how npx resolves
3. Build behavior differs between local (`npm run dist` uses v24) and CI (may use v26)

**Question:** Why install a different version in CI than what's in package.json? If v26 is
needed, package.json should be updated. If v24 is fine, the ensure step shouldn't override.

**Risk:** Builds may behave differently locally vs CI. electron-builder had breaking
changes between v24 and v26.

**Verdict:** _TBD_
**Changes:** We upgraded Electron stack: 31→39, electron-builder 24→26, Node 20→22

---

## 6. Electron Version is Outdated

`package.json` pins `electron: "31.7.7"`. As of 2026-03, Electron is at v34+. Electron 31
reached end-of-life in early 2025.

**Question:** Was 31.7.7 the latest at the time of development (Nov 2025)? It wasn't --
Electron 33 was current by then. Any reason for pinning to an already-EOL version?

**Risk:** No security patches. Chromium vulnerabilities in the bundled browser engine.

**Verdict:** _TBD_
**Changes:** We upgraded Electron stack: 31→39, electron-builder 24→26, Node 20→22

---

## 7. `asar: false` in package.json Build Config

```json
"asar": false
```

ASAR is Electron's archive format that packages app files into a single file, which:
- Improves startup performance
- Prevents casual tampering
- Avoids Windows path length issues

Disabling it means all source files are loose on disk.

**Question:** Was this disabled intentionally? Possible legitimate reason: R's file I/O
may not work well reading from within an ASAR archive. But this should be documented.

**Risk:** Minor -- larger install size, slightly slower startup, exposed source code.

**Verdict:** _TBD (likely justified for R interop, but should be documented)_

---

## 8. macOS Entitlements Include Audio Input

`electron/entitlements.mac.plist` includes:

```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

iDEP is a bioinformatics data analysis tool. It has no microphone functionality.

**Question:** Why does the app request microphone access? Was this copied from a template?

**Risk:** Apple reviewers may flag this if submitting to the Mac App Store. Users may be
alarmed by a microphone permission request from a genomics tool.

**Verdict:** _TBD_

---

## 9. macOS Signing and Notarization are Disabled/Commented Out

Multiple indicators that code signing was never finished:

1. `package.json`: `"notarize": false`
2. `build-electron-mac.yml`: All signing env vars commented out (lines 29-35)
3. `build-electron-mac.yml`: Notarization step commented out (lines 431-447)
4. `after-sign.js` exists and is wired up but will never run (notarize is false)

**Question:** Was signing/notarization deferred intentionally, or was it attempted and
abandoned? Without notarization, macOS Gatekeeper will block the app for most users
(they'd need to right-click > Open or disable Gatekeeper).

**Risk:** Mac users can't easily run the app without scary security warnings.

**Verdict:** _TBD_

---

## 10. macOS Sandbox is Disabled

Both entitlements files set:
```xml
<key>com.apple.security.app-sandbox</key>
<false/>
```

**Question:** Was this a deliberate decision because R can't run in a sandbox, or was it
the path of least resistance? Disabling the sandbox means the app has full filesystem
and network access.

**Risk:** Low in practice for a local-only analysis tool, but worth documenting.

**Verdict:** _TBD (likely justified -- R needs unrestricted file I/O)_

---

## 11. Repository URL Points to Contractor's Fork

`electron/package.json:13`:
```json
"repository": {
  "url": "https://github.com/raghaviCJanaswamy/idepGolem.git"
}
```

**Question:** Why does this point to the contractor's personal fork instead of the
organization's repo? Minor, but suggests the work was developed on their fork and
copy-pasted without cleanup.

**Risk:** None functionally, but sloppy.

**Verdict:** _TBD_

---

## 12. Monkey-Patching `download.file` and `untar` in Bootstrap

`main.js` generates `electron_bootstrap.R` at runtime, which includes:

```r
unlockBinding("download.file", ns_utils)
assign("download.file", patched_download, envir = ns_utils)
lockBinding("download.file", ns_utils)
```

And similarly for `untar`. This monkey-patches core R functions to:
- Cache the demo data tarball to avoid re-downloading
- Skip untar if data already exists

**Question:** Is there a reason this couldn't use R's standard caching mechanisms or
simple if/else checks before downloading? Monkey-patching base R functions is fragile
and will break if R changes internal function signatures.

**Risk:** Could silently break on R version upgrades. Hard to debug when it does.

**Verdict:** _TBD (the caching goal is legitimate, the implementation is concerning)_

---

## 13. `undici` as a Runtime Dependency

`package.json` includes `"undici": "^6.19.8"` and `main.js` uses:
```js
const { fetch } = require('undici');
```

Electron 31 ships with Node 20, which has a built-in global `fetch`. The `undici`
dependency is redundant.

**Question:** Was this added because there were issues with the built-in fetch, or was the
developer unaware that Node 20 includes it?

**Risk:** Unnecessary dependency bloat. Minor.

**Verdict:** _TBD_
**Changes:** We upgraded Electron stack: 31→39, electron-builder 24→26, Node 20→22

---

## 14. GSVA Treated as "Optional" on Linux but Required on Mac

Linux workflow (`build-electron-linux.yml:312-314`):
```yaml
# GSVA is treated as *optional* for Linux packaging
message("[install_desc] WARNING: GSVA is still missing; treating as optional on Linux.")
```

Mac workflow (`build-electron-mac.yml:312-315`):
```r
# GSVA is in the hard-requirement target list
target <- c("ComplexHeatmap","DESeq2",..."GSVA","WGCNA")
```

**Question:** Why is GSVA optional on Linux but required on Mac? GSVA is used by the
pathway analysis module. If it's missing, that feature silently doesn't work.

**Risk:** Linux Electron users may have broken pathway analysis.

**Verdict:** _TBD_

---

## 15. ggalt Handling Inconsistency

The Mac workflow has a special step to **patch DESCRIPTION and remove ggalt from Imports**
before building (`build-electron-mac.yml:166-192`). Linux and Windows do not.

All three workflows have a special-case install for `ggalt 0.4.0` from CRAN archive, but
the Mac build removes it from DESCRIPTION first, meaning idepGolem is built without it
as a declared dependency.

**Question:** Why is ggalt removed from DESCRIPTION only on Mac? If ggalt can't build on
macOS, shouldn't this be documented? If it can, why remove it?

**Risk:** The Mac Electron build is built against a different DESCRIPTION than Linux/Windows.

**Verdict:** _TBD_

---

## 16. macOS File Descriptor Limit Workaround

The Mac workflow has two dedicated steps to raise file descriptor limits:

```yaml
- name: Show current file descriptor limits
- name: Raise macOS file descriptor limits
    run: |
      sudo sysctl -w kern.maxfiles=65536
      sudo sysctl -w kern.maxfilesperproc=65536
      ulimit -n 65536 || ulimit -n 16384 || ulimit -n 8192
```

And again before the build step:
```yaml
ulimit -n 65536 || ulimit -n 16384 || ulimit -n 8192
```

**Question:** This suggests the Mac build was running into "too many open files" errors.
Was this caused by the sheer number of R packages, or something in the electron-builder
config? The cascading fallback (`65536 || 16384 || 8192`) suggests trial and error.

**Risk:** None if it works. Suggests the build is pushing against system limits, which
could become an issue as dependencies grow.

**Verdict:** _TBD (pragmatic fix, but symptom of a large build)_

---

## 17. Mac Build Prunes R Library but Linux/Windows Do Not

`build-electron-mac.yml` has a "Prune R library" step that removes help, docs, examples,
tests, and strips native libraries. Linux and Windows builds do not have this step.

**Question:** Why only on Mac? If this reduces bundle size (it does significantly), it
should be applied everywhere. If there's a Mac-specific reason, document it.

**Risk:** Mac bundle is smaller but potentially missing files that R packages expect.
Linux/Windows bundles are unnecessarily bloated.

**Verdict:** _TBD_

---

## 18. Linux Build Missing R Library Prune + Other Mac-only Steps

Comparing the three workflows side by side:

| Feature | Linux | Mac | Windows |
|---------|-------|-----|---------|
| R library pruning | No | Yes | No |
| DESCRIPTION patching (ggalt) | No | Yes | No |
| File descriptor limits | No | Yes | No |
| Bioc package list size | 18 pkgs | 18 pkgs | 11 pkgs |
| GSVA requirement | Optional | Required | Not checked separately |

**Question:** Were the Linux and Windows builds tested less thoroughly than Mac? The Mac
build has multiple workarounds that suggest hands-on debugging, while Linux/Windows seem
like earlier, less refined copies.

**Verdict:** _TBD_

---

## 19. Description Says "MyGolemElectronApp"

`package.json:4`:
```json
"description": "MyGolemElectronApp with vendored R"
```

**Question:** Was this a template placeholder that was never updated?

**Risk:** None functionally. Shows lack of polish.

**Verdict:** _TBD_

---

## 20. Typo in Commit Message

The commit message reads: "Electron Packaging for **Widows** and MAC"

Should be "Windows." Minor, but combined with other items, suggests rushed work.

---

## 21. CI Node Version Pinned to Near-EOL Node 20

All three CI workflows pin `node-version: 20`:

| File | Line |
|------|------|
| `build-electron-windows.yml` | `:82` |
| `build-electron-linux.yml` | `:90` |
| `build-electron-mac.yml` | `:82` |

Node 20 reaches end-of-life in **April 2026**. At the time of the commit (Nov 2025),
Node 22 had been the active LTS since October 2024 — over a year. Node 20 was already
in maintenance mode.

This choice is consistent with Electron 31 bundling Node 20.x internally, but Electron 31
was itself already EOL by the time this work was committed (see #6). The entire version
chain was outdated at time of delivery:

| Component | Version Delivered (Nov 2025) | What Was Current (Nov 2025) |
|-----------|----------------------------|----------------------------|
| Electron | 31.7.7 (EOL early 2025) | 33.x |
| Chromium (bundled in Electron) | 126 | 130+ |
| Node.js (bundled in Electron) | 20.x (maintenance) | 22.x (active LTS) |
| Node.js (CI build toolchain) | 20 (maintenance) | 22 (active LTS) |
| electron-builder | 24.13.3 (see #5) | 25.x+ |

**Question:** Why were EOL/maintenance versions chosen across the board? Electron 33 and
Node 22 LTS were both well-established by November 2025. Was this based on a tutorial or
template that used older versions, or was there a specific compatibility concern?

**Risk:** The entire Electron dependency chain (Electron → Chromium → Node → electron-builder)
was delivered already outdated. These components are tightly coupled — they cannot be
upgraded independently. This compounds the technical debt from #5 and #6.

**Verdict:** _TBD_
**Changes:** We upgraded Electron stack: 31→39, electron-builder 24→26, Node 20→22

---

## 22. Bootstrap `setwd(app_dir)` Points CWD at Read-Only Install Directory

`main.js` generates a bootstrap R script at runtime. That script includes:

```r
setwd(app_dir)
```

Where `app_dir` is the installed application directory:
- Windows: `C:\Users\...\Programs\idepGolem\resources\app`
- Linux: `/opt/iDEP/resources/app`

This is a **read-only** directory. Meanwhile, `main.js` already creates a writable user data directory (`data_dir`) and passes it as `IDEP_DATABASE`. The R source code (`fct_database.R`, `run_app.R`) downloads and extracts the database relative to CWD. With CWD pointing at the read-only app directory, all writes fail with "Permission denied" on Linux.

Nothing in the R package requires CWD to be the app directory:
- Golem resolves paths through `app_sys()` / `system.file()`, not CWD
- Package loading uses `.libPaths()`, not CWD
- `getwd()` calls in report modules (`mod_02`, `mod_03`, `mod_04`, `mod_06`) just need a writable directory for temp files
- `fct_06_pathway.R` uses `getwd()` for a log message only

**Question:** Why was CWD set to the app install directory instead of the writable data directory? The app directory contains the R package and vendored libraries, but none of them are accessed via CWD. Was this a "just to be safe" assumption that R needs to run from the app folder, or was it copied from a template?

**Risk:** **High.** This is the root cause of the Linux Electron first-launch crash (exit code 1, "Permission denied" on database download). On Windows it happened to work because the install directory was writable, masking the bug.

**Verdict:** Fixed. Changed `setwd(app_dir)` to `setwd(data_dir)` so CWD points to the writable user data directory. All existing R download/extract logic works correctly when CWD is writable. Zero R source changes needed — clean separation of concerns.

---

## Summary Table

| # | Issue | Severity | Likely Explanation |
|---|-------|----------|--------------------|
| 1 | Three different R versions | **High** | Evolved over time, not reconciled |
| 2 | Duplicate workflow file | Medium | Copy left behind |
| 3 | Broken Linux script | **High** | Draft/notes never cleaned up |
| 4 | Hardcoded Bioc list varies by platform | **High** | Copy-paste without updating |
| 5 | electron-builder version mismatch | Medium | CI workaround not synced to package.json |
| 6 | Outdated Electron | Medium | Pinned during dev, never updated |
| 7 | asar: false | Low | Likely needed for R |
| 8 | Audio input entitlement | Low | Template copy-paste |
| 9 | Signing/notarization disabled | Medium | Deferred/incomplete |
| 10 | Sandbox disabled | Low | Likely needed for R |
| 11 | Repo URL points to fork | Low | Not cleaned up |
| 12 | Monkey-patching base R | Medium | Works but fragile |
| 13 | Unnecessary undici dep | Low | Unaware of built-in fetch |
| 14 | GSVA optional on Linux only | Medium | Build issue worked around |
| 15 | ggalt handling varies | Medium | Mac-specific fix not ported |
| 16 | FD limit workaround | Low | Pragmatic |
| 17 | Pruning only on Mac | Low | Mac-specific optimization |
| 18 | Workflows not feature-symmetric | Medium | Evolved unevenly |
| 19 | Placeholder description | Low | Template not updated |
| 20 | Typo in commit message | Low | Rushed |
| 21 | CI Node 20 was already maintenance-mode at delivery | **High** | Entire Electron/Node/Chromium chain delivered outdated |
| 22 | Bootstrap `setwd(app_dir)` points CWD at read-only dir | **High** | Assumed R needs to run from app dir; masked on Windows where install dir was writable |

---

## Overall Assessment

_To be filled in after contractor discussion._

**Positive signals:**
- The core architecture (Electron wrapping a Shiny app via spawned R process) is sound
- main.js is well-structured with proper error handling, splash screen, port detection
- Demo data caching logic works (implementation questionable but goal is right)
- macOS code signing infrastructure is in place even if not enabled

**Concerns:**
- Three different R versions with no documentation
- Platform builds are not feature-symmetric (suggests each was debugged independently without backporting fixes)
- Broken/draft script committed (`get_r_linux.sh`)
- Hardcoded package lists instead of using standard R tooling
- Repo URL, description, and commit message suggest limited attention to detail
