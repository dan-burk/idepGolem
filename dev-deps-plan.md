# Dependency Management Plan

## Background
- 355+ R dependencies across CRAN, Bioconductor, and archived/GitHub sources
- Two repos: `iDEP-SDSU/idep` (production Docker + `librarySetup.R`) and `gexijin/idepGolem` (this repo, Golem rewrite)
- Production Docker image built from the other repo — not connected to this one
- `devtools::install_deps()` ignores `biocViews` — we duplicated those packages into `Imports` as a workaround
- All versions now pinned in `renv.lock` (first time this project has reproducible deps)

## Build Methodology Comparison

### Original Production Build (`iDEP-SDSU/idep` repo → `gexijin/idep:latest`)

The production Docker image is built from the `iDEP-SDSU/idep` repo, not this one. Its approach:

**Dockerfile**: `FROM rocker/shiny:latest` (no version pinning — R version changes on any rebuild)

**Package installation** (`classes/librarySetup.R`):
1. Deletes ALL non-base packages from the R library (clean slate every build)
2. Installs CRAN packages via `install.packages()` from `cran.rstudio.com` (source on Linux — no prebuilt binaries)
3. Installs Bioconductor packages via `BiocManager::install()` (source tarballs from bioconductor.org, auto-detects Bioc version — no explicit pinning)
4. Retries in a while loop until all packages install or nothing new succeeds
5. Manually installs special cases: PGSEA + KEGG.db from Bioc archive URLs, ggalt from CRAN archive, ottoPlots from GitHub
6. Installs idepGolem itself via `remotes::install_github("espors/idepGolem")` — note: installs from `espors`, not `gexijin` (likely a stale org reference)

**Problems**:
- No version pinning (R, Bioconductor, or packages) — builds are not reproducible
- All packages compile from source on Linux — slow (potentially hours)
- No PPM — misses the free performance win of prebuilt binaries
- Retry-loop approach masks root causes of install failures
- Deletes all packages every build — no caching, full rebuild every time
- Installs idepGolem from unexpected GitHub org (`espors` vs `gexijin`)

**The old devcontainer** (`gexijin/idepGolem` repo, pre-fork) sidestepped all of this by using `FROM gexijin/idep:latest` — inheriting the production image with all packages pre-installed. This worked for development but meant the dev environment was not transparent and tied to production's build schedule.

### Current Build (this repo, post-fork)

**Dockerfile**: `FROM rocker/shiny-verse:4.5.1` (pinned R version, Ubuntu Noble 24.04)

**Package installation**:
1. CRAN packages: prebuilt Linux binaries from Posit Package Manager (PPM) — fast, no compilation
2. Bioconductor packages: source tarballs from bioconductor.org (PPM does NOT serve Bioc binaries — tested 2026-03-24)
3. Archived packages (biclust, ggalt): installed from source via archive URLs in `Remotes`
4. Special packages (PGSEA, KEGG.db, ottoPlots): installed via `Remotes` field in `DESCRIPTION`
5. All versions locked in `renv.lock` — install via `renv::restore()`

## Pinned Environment

### Base
- **R**: 4.5.1
- **Base image**: `FROM rocker/shiny-verse:4.5.1` (Ubuntu Noble 24.04)
- **Bioconductor**: 3.21
- **Posit Package Manager**: `https://packagemanager.posit.co/cran/__linux__/noble/latest`
- **Package versions**: see `renv.lock` (single source of truth)

### System deps (apt-get)
```
build-essential cmake libcurl4-openssl-dev libssl-dev libxml2-dev
libfontconfig1-dev libharfbuzz-dev libfribidi-dev libfreetype6-dev
libpng-dev libtiff5-dev libjpeg-dev libgit2-dev libsodium-dev
libcairo2-dev libglpk-dev libmagick++-6.q16-dev libproj-dev
```

### Packages requiring source compilation (not binary)
These failed with binary installs due to system lib mismatches or CRAN archival:
| Package | Reason |
|---------|--------|
| magick | binary linked to `.so.8`, system has `.so.9` |
| proj4 | binary linked to old libproj |
| biclust | archived from CRAN |
| ggalt | archived from CRAN |

### Packages from non-standard sources (Remotes)
| Package | Source |
|---------|--------|
| ottoPlots | `github::espors/ottoPlots` |
| PGSEA | Bioconductor 3.10 archive URL |
| KEGG.db | Bioconductor 2.11 archive URL |

## Completed Phases (R 4.4.3 / Bioconductor 3.20)

These phases validated the approach on R 4.4.3. We are now redoing them on R 4.5.1 to match production before building the base image.

### Phase 1: Get a working install — DONE (R 4.4.3)
All 355+ packages install successfully. Key fixes: added 14 missing packages to `Imports`, added Bioc repos to `Rprofile.site`, added system deps (`libmagick++-6.q16-dev`, `libproj-dev`), added archived packages to `Remotes`. See git history for details.

### Phase 1.5: PPM for Bioconductor binaries — TESTED, NOT VIABLE
PPM does **not** serve Bioconductor binaries despite the setup UI suggesting otherwise. The `__linux__/noble` URL pattern resolves but serves identical source tarballs (verified by MD5 + direct test). PPM admin docs confirm: "Package Manager does not provide binary packages for Bioconductor sources." CRAN binaries work; Bioc always compiles from source. Phase 3 base image is the only path to faster installs.

### Phase 2: Snapshot with renv — DONE (R 4.4.3)
`renv.lock` committed with exact versions, sources, and hashes for all packages. Install via `renv::restore()`.

**renv is the R equivalent of Python's venv + pip freeze:**

| | Python | R |
|---|---|---|
| Lockfile | `requirements.txt` / `poetry.lock` | `renv.lock` |
| Environment dir | `.venv/` | `renv/library/` |
| Activate | `source .venv/bin/activate` | `source("renv/activate.R")` (auto via `.Rprofile`) |
| Install from lock | `pip install -r requirements.txt` | `renv::restore()` |
| Save current state | `pip freeze` | `renv::snapshot()` |
| Gitignored | `.venv/` | `renv/library/` |
| Committed | `requirements.txt` | `renv.lock` + `renv/activate.R` |

Key difference: renv activates automatically via `.Rprofile` whenever R starts in the project directory — no manual `activate` step. `renv.lock` records exact version, source (CRAN/Bioc/GitHub/URL), and hash for every package. It does **not** record whether a package was installed as binary or source — that's determined at `renv::restore()` time based on platform and available repos. Initialized via
```r
renv::init()
renv::snapshot()
renv::restore()
```

## Upgrade to R 4.5.1 / Bioconductor 3.21 — NEXT

Production iDEP is running R 4.5.1. No reason to build infrastructure for 4.4.3 when we'd immediately need to upgrade. Plan: redo Phase 1 and 2 on R 4.5.1, then go straight to Phase 3.

### What needs to change

1. **Devcontainer Dockerfiles**: `FROM rocker/shiny-verse:4.5.1` (was `4.4.3`)
2. **Bioconductor version**: 3.21 (was 3.20) — update `Rprofile.site` repo URLs
3. **PPM URL**: stays `https://packagemanager.posit.co/cran/__linux__/noble/latest` (Ubuntu Noble unchanged)
4. **Rebuild container** and re-run `devtools::install_deps(".", dependencies = TRUE, upgrade = "never")`
5. **Fix any breakage** — new Bioc versions may deprecate/rename packages, archived packages may need new URLs
6. **Re-snapshot**: `renv::snapshot()` to generate new `renv.lock` for R 4.5.1 / Bioc 3.21
7. **Verify app runs**: `source("dev/run_dev.R")`

### Ecosystem readiness (verified 2026-03-25)

| Component | Status |
|---|---|
| `rocker/shiny-verse:4.5.1` | Available on Docker Hub |
| Bioconductor 3.21 | Released April 2025 |
| PPM CRAN binaries for R 4.5 | Available for Ubuntu Noble |
| PPM Bioc binaries | Still not available (same as 3.20) |

### Potential issues to watch for
- Archived packages (biclust, ggalt, PGSEA, KEGG.db) may need updated archive URLs for Bioc 3.21
- System lib `.so` mismatches may differ on R 4.5.1 — magick/proj4 may or may not need source compilation
- Some Bioc packages may have been deprecated or replaced between 3.20 and 3.21

## Phase 3: Build `idep-base` image — AFTER UPGRADE

### Architecture: separate repo for the base image

The base image is infrastructure, not the app. It has a different build cadence (rebuild when deps change), different CI (Docker build + push), and will serve multiple R versions. This follows the pattern used by rocker (`rocker-org/rocker-versioned2`) and Bioconductor (`Bioconductor/bioconductor_docker`) — keep image-building separate from the software that runs on it.

### The R/Bioconductor version matrix

Each R version locks to a Bioconductor version, which changes the entire dependency tree. Each combination needs its own `renv.lock`.

| R | Bioconductor | Ubuntu | Status |
|---|---|---|---|
| 4.5.1 | 3.21 | Noble 24.04 | Current (matches production) |
| 4.4.3 | 3.20 | Noble 24.04 | Previous (validated, not shipping) |
| 4.6.x | 3.22 | TBD | Future |

### Base image repo structure (`gexijin/idep-base`)

```
idep-base/
├── Dockerfile                  # single, parameterized via build args
├── system-deps.txt             # shared apt-get list
├── versions/
│   ├── 4.5.1/
│   │   ├── renv.lock           # generated from working install
│   │   └── Rprofile.site       # repo config for this R/Bioc combo
│   ├── 4.6.x/
│   │   ├── renv.lock
│   │   └── Rprofile.site
│   └── ...
└── .github/workflows/
    └── build.yml               # matrix build across versions
```

**Parameterized Dockerfile:**
```dockerfile
ARG R_VERSION=4.5.1
FROM rocker/shiny-verse:${R_VERSION}

COPY system-deps.txt /tmp/
RUN apt-get update && xargs apt-get install -y < /tmp/system-deps.txt

ARG R_VERSION
COPY versions/${R_VERSION}/Rprofile.site /usr/local/lib/R/etc/Rprofile.site
COPY versions/${R_VERSION}/renv.lock /tmp/renv.lock

RUN R -e 'install.packages("renv"); renv::restore(lockfile = "/tmp/renv.lock")'
```

**CI matrix build** (`.github/workflows/build.yml`):
```yaml
strategy:
  matrix:
    r_version: ["4.5.1"]
steps:
  - uses: docker/build-push-action@v5
    with:
      build-args: R_VERSION=${{ matrix.r_version }}
      tags: ghcr.io/gexijin/idep-base:r${{ matrix.r_version }}
```

**Image tags** (GHCR):
- `ghcr.io/gexijin/idep-base:r4.5.1`
- `ghcr.io/gexijin/idep-base:latest` → current production R version

### What changes in this repo

The devcontainer Dockerfile shrinks to:
```dockerfile
FROM ghcr.io/gexijin/idep-base:r4.5.1
# Dev tools only — Node, Claude, language server, etc.
```

Dev startup goes from ~1 hour (install all deps) to ~1 minute (pull cached image + install dev tools). Rebuild the base image only when deps change.

### Workflow for adding a new R version

1. In `idep-base` repo: create `versions/{ver}/`, spin up a temporary container with that R version, install deps, `renv::snapshot()` to generate the lockfile
2. CI builds `ghcr.io/gexijin/idep-base:r{ver}` automatically
3. In this repo: run tests against the new image, fix any breaking changes
4. Update devcontainer to point at the new tag

### Where things live

| Concern | Where |
|---|---|
| Base image Dockerfile | `gexijin/idep-base` repo (new) |
| `renv.lock` per R version | `gexijin/idep-base/versions/{ver}/` |
| System deps list | `gexijin/idep-base/system-deps.txt` |
| CI for image builds | `gexijin/idep-base/.github/workflows/` |
| Base images | GHCR (`ghcr.io/gexijin/idep-base`) |
| App code + tests | This repo (`gexijin/idepGolem`) |
| Devcontainer | This repo, `FROM ghcr.io/gexijin/idep-base:r4.5.1` |
| Active dev lockfile | This repo, `renv.lock` |

## Issues for Upstream Maintainer
- **Duplicate entries in DESCRIPTION Imports** (pre-existing, not introduced by us):
  - `ggraph` — lines 31 and 72
  - `tidytext` — lines 61 and 73
  - `wordcloud2` — lines 66 and 74
- **Wrong GitHub org in `librarySetup.R`**: `iDEP-SDSU/idep/classes/librarySetup.R` installs idepGolem from `espors/idepGolem` instead of `gexijin/idepGolem` — likely a stale reference to an old org
- **Stale roxygen2 docs**: `man/suggest_edge_cutoff.Rd` generates R CMD check warnings (unknown macro `\item`, unexpected section headers) because it was generated by an old version of roxygen2. Fix by running `devtools::document()` with current roxygen2. Other `.Rd` files may have the same issue — regenerate all docs when ready

## Key Lessons
- PPM serves prebuilt CRAN binaries for Linux but **not** Bioconductor binaries
- Container system libs must match the binary's expected `.so` version or you get load failures
- `Remotes` only specifies *where* to fetch — package must also be in `Imports` to get installed
- Archived CRAN packages have no binaries anywhere — must install from source via URL
- **Jammy vs Noble**: Rocker switched to Noble at R 4.4.2. Posit PM URLs fixed to `noble` in both Dockerfiles. CRAN binaries work correctly. Bioconductor binaries are NOT available from PPM (see Phase 1.5 findings).


## ARM64 Windows (Electron Desktop Build)

### Current state — x86_64 only

The entire Windows Electron pipeline is hardcoded for x86_64. On ARM64 Windows 11, the x86_64 build runs via emulation but with a performance penalty. The following files contain x86_64 assumptions:

| File | Line(s) | Issue |
|---|---|---|
| `electron/scripts/get_r_windows.ps1` | 34-38 | Download URLs fetch `R-$Rver-win.exe` (x86_64). ARM64 builds use `R-$Rver-aarch64-win.exe` |
| `electron/scripts/get_r_windows.ps1` | 86 | Sanity check looks for `bin\x64\R.dll`. ARM64 R places it at `bin\aarch64\R.dll` |
| `electron/main.js` | 58 | Fallback path `bin/x64/Rscript.exe`. ARM64 R uses `bin/aarch64/Rscript.exe`. (Primary candidate `bin/Rscript.exe` on line 57 works on both) |
| `electron/package.json` | 49 | `"arch": ["x64"]` — Electron builder only targets x64 |
| `.github/workflows/build-electron-windows.yml` | 113 | `rtools-version: '45'` installs x86_64 Rtools. ARM64 needs `rtools45-aarch64` |
| `.github/workflows/build-electron-windows.yml` | 197 | `npx electron-builder --win --x64` — only builds x64 artifact |

### CRAN ARM64 availability (verified 2026-03-25)

- R 4.4.0+ has official Windows ARM64 installers on CRAN (`R-$Rver-aarch64-win.exe`)
- Rtools45 has an aarch64 variant (`rtools45-aarch64.exe`) available from CRAN
- CRAN serves prebuilt ARM64 Windows binaries for most packages

### PPM ARM64 availability — UNKNOWN

Posit Package Manager binary availability for Windows ARM64 has not been tested. If PPM does not serve ARM64 Windows binaries, packages would need to come from CRAN directly or compile from source with `rtools45-aarch64`.

### Changes needed for native ARM64 support

#### 1. `electron/scripts/get_r_windows.ps1` — architecture detection + installer URL

Add architecture detection (similar to `get_r_mac.sh` lines 9-11):
```powershell
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x64" }
```

Adjust download URLs based on `$arch`:
- x64: `R-$Rver-win.exe` (current behavior)
- aarch64: `R-$Rver-aarch64-win.exe`

Update the DLL sanity check (line 86):
```powershell
$destRdll = Join-Path $destR "bin\$arch\R.dll"
```

#### 2. `electron/main.js` — add aarch64 candidate path

```js
const candidates = [
  binDir && path.join(binDir, 'Rscript.exe'),
  R_ROOT && path.join(R_ROOT, 'bin', 'x64', 'Rscript.exe'),
  R_ROOT && path.join(R_ROOT, 'bin', 'aarch64', 'Rscript.exe'),
].filter(Boolean);
```

#### 3. `electron/package.json` — add arm64 target

```json
"win": {
  "target": [{ "target": "nsis", "arch": ["x64", "arm64"] }]
}
```

This produces two installers: one x64, one arm64. Each must bundle the matching R runtime.

#### 4. `.github/workflows/build-electron-windows.yml` — matrix build

Add an architecture matrix so CI builds both x64 and arm64 artifacts:
```yaml
strategy:
  matrix:
    arch: [x64, arm64]
steps:
  - name: Setup R (with Rtools)
    uses: r-lib/actions/setup-r@v2
    with:
      r-version: '4.5.1'
      rtools-version: ${{ matrix.arch == 'arm64' && '45-aarch64' || '45' }}
  # ...
  - run: npx electron-builder --win --${{ matrix.arch }}
```

**Blocker**: GitHub Actions Windows runners are x86_64. ARM64 cross-compilation of R packages from source (those not available as binaries) may not work without an ARM64 runner or cross-toolchain. Packages that require source compilation (biclust, ggalt, PGSEA, KEGG.db) are the risk area.

#### 5. `electron/scripts/install_packages.R` — repo URLs

If PPM does not serve ARM64 Windows binaries, `install_packages.R` may need to prefer CRAN binary repos over PPM for ARM64, or fall back to source compilation with `rtools45-aarch64`.

### Decision: when to implement

ARM64 Windows is a growing user base (Surface Pro, Snapdragon X laptops) but not yet mainstream for bioinformatics. The x86_64 build runs fine under emulation. Recommend:
- **Now**: add the `aarch64` candidate path to `main.js` (one-line, no-risk change)
- **Later**: full ARM64 pipeline after Phase 3 base image is stable and PPM ARM64 support is verified


## Open Questions
- Should `biocViews` packages live only in `Imports`? Duplication works but is messy
- Consolidate with production Docker build in `iDEP-SDSU/idep`?