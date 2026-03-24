# Dependency Management Plan

## Background
- 355+ R dependencies, zero version pinning, no `renv.lock`
- Two repos: `iDEP-SDSU/idep` (production Docker + `librarySetup.R`) and `gexijin/idepGolem` (this repo, Golem rewrite)
- Production Docker image built from the other repo — not connected to this one
- Neither repo pins versions. Only 4 archived packages have fixed versions (KEGG.db, PGSEA, ggalt, biclust)
- `devtools::install_deps()` ignores the `biocViews` field — only reads `Imports`/`Suggests`/`Remotes`
- We worked around this by duplicating biocViews packages into `Imports` and adding Bioc repos to `Rprofile.site`, so `install_deps()` now installs everything in one shot

## Build Methodology Comparison

### Original Production Build (`iDEP-SDSU/idep` repo → `gexijin/idep:latest`)

**How is the production iDEP Image Built and Maintained?**

**H0 (Null Hypothesis)**
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

If this is the proces. Why not use the rocker base R image rather than the rocker/shiny?

**The old devcontainer** (`gexijin/idepGolem` repo, pre-fork) sidestepped all of this by using `FROM gexijin/idep:latest` — inheriting the production image with all packages pre-installed. This worked for development (edit code, run `dev/run_dev.R`, commit, push) but meant the dev environment was not transparent and tied to production's build schedule.

### Current Build (this repo, post-fork)

**Dockerfile**: `FROM rocker/shiny-verse:4.4.3` (pinned R version, Ubuntu Noble 24.04)

**Package installation**:
1. CRAN packages: prebuilt Linux binaries from Posit Package Manager (PPM) — fast, no compilation
2. Bioconductor packages: source tarballs from bioconductor.org (configured via `Rprofile.site` with explicit Bioc 3.20 repo URLs)
3. Archived packages (biclust, ggalt): installed from source via archive URLs in `Remotes`
4. Special packages (PGSEA, KEGG.db, ottoPlots): installed via `Remotes` field in `DESCRIPTION`
5. Everything installed in one shot via `devtools::install_deps(".", dependencies = TRUE)`

**Improvements over original**:
- R version pinned (4.4.3) — reproducible base
- Bioconductor version explicit (3.20) — no auto-detection surprises
- CRAN packages install as prebuilt binaries via PPM — minutes instead of hours
- All dependencies declared in `DESCRIPTION` — single `install_deps()` call, no manual scripts
- System deps explicitly listed in Dockerfile



### Proposed Build (PPM for Bioconductor)

Same as current, but Bioconductor packages also install as prebuilt binaries from PPM.

**Change**: Replace manual Bioc repo URLs in `Rprofile.site` with PPM's BiocManager mirror configuration:
```r
# Old: manual Bioc URLs (source tarballs from bioconductor.org)
options(repos = c(
  CRAN = "https://packagemanager.posit.co/cran/__linux__/noble/latest",
  BioCsoft = "https://bioconductor.org/packages/3.20/bioc",
  BioCann  = "https://bioconductor.org/packages/3.20/data/annotation",
  BioCexp  = "https://bioconductor.org/packages/3.20/data/experiment"
))

# New: PPM as BiocManager mirror (prebuilt binaries for Ubuntu Noble)
options(
  BioC_mirror = "https://packagemanager.posit.co/bioconductor/latest",
  BIOCONDUCTOR_CONFIG_FILE = "https://packagemanager.posit.co/bioconductor/latest/config.yaml",
  repos = c(CRAN = "https://packagemanager.posit.co/cran/__linux__/noble/latest")
)
Sys.setenv("R_BIOC_VERSION" = "3.20")
```

**Why**:
- **Speed**: Bioconductor packages install as prebuilt binaries instead of compiling from source
- **Reproducibility**: Bioc version explicitly pinned via `R_BIOC_VERSION`, PPM mirrors the same packages as bioconductor.org
- **No downside if PPM has full coverage**: PPM serves the same packages at the same versions — just pre-compiled. However, the new config removes the bioconductor.org URLs entirely, so if PPM is missing a package (e.g., a niche annotation DB), the install will fail rather than fall back. Must verify coverage of all ~30 Bioc packages before committing to this approach
- **Official approach**: This is the configuration recommended by PPM's own setup page for Ubuntu Noble + Bioconductor 3.20

## What We Changed So Far
- Found 14 packages used in code but missing from `DESCRIPTION` — added to `Imports`
- Duplicated `biocViews` packages into `Imports` so `install_deps()` picks them up
- Restored `biocViews` section (kept for convention, but `install_deps` ignores it)
- Added Bioconductor repos to `Rprofile.site` via `sudo sed` **(container-local only — NOT in Dockerfile yet, will be lost on rebuild)**
- Added `biclust` and `ggalt` to `Remotes` (archived from CRAN)
- Added `libmagick++-6.q16-dev` and `libproj-dev` to both Dockerfiles (missing system deps)
- Added "Linux: Developer mode" section to `README.md`
- Added `ottoPlots`, `PGSEA`, `KEGG.db` to `Imports` — they were in `Remotes` (source location) but never declared as dependencies, so `install_deps()` skipped them

## Lessons Learned (Phase 1)
- Posit Package Manager (RSPM) serves prebuilt binaries for a specific Ubuntu version
- If container system libs don't match the binary's expected version → `.so` load failures
- Archived CRAN packages (biclust, ggalt) have no binaries — must install from source via URL
- `Remotes` only specifies *where* to fetch — package must also be in `Imports` to get installed
- Fix: pin R version + Ubuntu version in Dockerfile, keep system deps in sync
- Most packages install fine as binaries. Only track the exceptions that need source compilation.

## Pinned Environment (known working as of 2026-03-23)

### Base
- **R**: 4.4.3
- **Base image**: `FROM rocker/shiny-verse:4.4.3` (Ubuntu Noble 24.04 — rocker switched from Jammy to Noble starting with R 4.4.2)
- **Bioconductor**: 3.20
- **Posit Package Manager**: `https://packagemanager.posit.co/cran/__linux__/noble/latest`
  - Was `jammy` — root cause of magick/proj4 `.so` failures. Fixed to `noble` in both Dockerfiles.

### System deps (apt-get)
```
build-essential cmake libcurl4-openssl-dev libssl-dev libxml2-dev
libfontconfig1-dev libharfbuzz-dev libfribidi-dev libfreetype6-dev
libpng-dev libtiff5-dev libjpeg-dev libgit2-dev libsodium-dev
libcairo2-dev libglpk-dev libmagick++-6.q16-dev libproj-dev
```

### Packages requiring source compilation (not binary)
These failed with binary installs due to system lib mismatches or CRAN archival:
| Package | Version | Reason |
|---------|---------|--------|
| magick | (dep) | binary linked to `.so.8`, system has `.so.9` |
| proj4 | (dep) | binary linked to old libproj |
| biclust | 2.0.3.1 | archived from CRAN |
| ggalt | 0.4.0 | archived from CRAN |

### Packages from non-standard sources (Remotes)
| Package | Version | Source |
|---------|---------|--------|
| ottoPlots | 1.0.0 | `github::espors/ottoPlots` |
| PGSEA | 1.60.0 | Bioconductor 3.10 archive URL |
| KEGG.db | 2.8.0 | Bioconductor 2.11 archive URL |

### All declared packages (source of truth)
RSPM = Posit Package Manager (binary), Bioc = Bioconductor, non-CRAN = archive/GitHub/annotation DB

| Package | Version | Source |
|---------|---------|--------|
| biclust | 2.0.3.1 | source (archived) |
| Biobase | 2.66.0 | Bioc 3.20 |
| BiocGenerics | 0.52.0 | Bioc 3.20 |
| BiocManager | 1.30.27 | RSPM |
| bslib | 0.10.0 | RSPM |
| circlize | 0.4.17 | RSPM |
| colorspace | 2.1-1 | RSPM |
| ComplexHeatmap | 2.22.0 | Bioc 3.20 |
| config | 0.3.2 | RSPM |
| data.table | 1.17.0 | RSPM |
| DBI | 1.2.3 | RSPM |
| dendextend | 1.19.1 | RSPM |
| DESeq2 | 1.46.0 | Bioc 3.20 |
| dplyr | 1.1.4 | RSPM |
| DT | 0.34.0 | RSPM |
| dynamicTreeCut | 1.63-1 | RSPM |
| e1071 | 1.7-17 | RSPM |
| edgeR | 4.4.2 | Bioc 3.20 |
| factoextra | 2.0.0 | RSPM |
| fgsea | 1.32.4 | Bioc 3.20 |
| flashClust | 1.1-4 | RSPM |
| gage | 2.56.0 | Bioc 3.20 |
| GenomicRanges | 1.58.0 | Bioc 3.20 |
| GetoptLong | 1.1.0 | RSPM |
| ggalt | 0.4.0 | source (archived) |
| ggplot2 | 4.0.2 | RSPM |
| ggpubr | 0.6.3 | RSPM |
| ggraph | 2.2.2 | RSPM |
| ggrepel | 0.9.8 | RSPM |
| ggupset | 0.4.1 | RSPM |
| GO.db | 3.20.0 | Bioc annotation |
| golem | 0.5.1 | RSPM |
| GSVA | 2.0.7 | Bioc 3.20 |
| hexbin | 1.28.5 | RSPM |
| hgu133plus2.db | 3.13.0 | Bioc annotation |
| htmltools | 0.5.9 | RSPM |
| igraph | 2.2.2 | RSPM |
| InteractiveComplexHeatmap | 1.14.0 | Bioc 3.20 |
| IRanges | 2.40.1 | Bioc 3.20 |
| kableExtra | 1.4.0 | RSPM |
| KEGG.db | 2.8.0 | Bioc 2.11 archive |
| KEGGREST | 1.46.0 | Bioc 3.20 |
| knitr | 1.51 | RSPM |
| limma | 3.62.2 | Bioc 3.20 |
| org.Ag.eg.db | 3.20.0 | Bioc annotation |
| org.At.tair.db | 3.20.0 | Bioc annotation |
| org.Bt.eg.db | 3.20.0 | Bioc annotation |
| org.Ce.eg.db | 3.20.0 | Bioc annotation |
| org.Cf.eg.db | 3.20.0 | Bioc annotation |
| org.Dm.eg.db | 3.20.0 | Bioc annotation |
| org.Dr.eg.db | 3.20.0 | Bioc annotation |
| org.EcK12.eg.db | 3.20.0 | Bioc annotation |
| org.EcSakai.eg.db | 3.20.0 | Bioc annotation |
| org.Gg.eg.db | 3.20.0 | Bioc annotation |
| org.Hs.eg.db | 3.20.0 | Bioc annotation |
| org.Mm.eg.db | 3.20.0 | Bioc annotation |
| org.Mmu.eg.db | 3.20.0 | Bioc annotation |
| org.Pt.eg.db | 3.20.0 | Bioc annotation |
| org.Rn.eg.db | 3.20.0 | Bioc annotation |
| org.Sc.sgd.db | 3.20.0 | Bioc annotation |
| org.Ss.eg.db | 3.20.0 | Bioc annotation |
| org.Xl.eg.db | 3.20.0 | Bioc annotation |
| ottoPlots | 1.0.0 | GitHub |
| pathview | 1.46.0 | Bioc 3.20 |
| PCAtools | 2.18.0 | Bioc 3.20 |
| PGSEA | 1.60.0 | Bioc 3.10 archive |
| pkgload | 1.5.0 | RSPM |
| plotly | 4.12.0 | RSPM |
| png | 0.1-9 | RSPM |
| preprocessCore | 1.68.0 | Bioc 3.20 |
| purrr | 1.0.4 | RSPM |
| QUBIC | 1.34.0 | Bioc 3.20 |
| R.utils | 2.13.0 | RSPM |
| RColorBrewer | 1.1-3 | RSPM |
| ReactomePA | 1.50.0 | Bioc 3.20 |
| readxl | 1.4.5 | RSPM |
| reshape2 | 1.4.5 | RSPM |
| rmarkdown | 2.30 | RSPM |
| RSQLite | 2.3.9 | RSPM |
| Rtsne | 0.17 | RSPM |
| runibic | 1.28.0 | Bioc 3.20 |
| S4Vectors | 0.44.0 | Bioc 3.20 |
| shiny | 1.13.0 | RSPM |
| shinyAce | 0.4.4 | RSPM |
| shinyBS | 0.65.0 | RSPM |
| shinybusy | 0.3.3 | RSPM |
| shinyjs | 2.1.1 | RSPM |
| stringr | 1.5.1 | RSPM |
| SummarizedExperiment | 1.36.0 | Bioc 3.20 |
| tidyr | 1.3.1 | RSPM |
| tidyselect | 1.2.1 | RSPM |
| tidytext | 0.4.3 | RSPM |
| tippy | 0.1.0 | RSPM |
| visNetwork | 2.1.4 | RSPM |
| WGCNA | 1.74 | RSPM |
| wordcloud2 | 0.2.1 | RSPM |

*Note: base R packages (graphics, grDevices, grid, stats, utils) omitted — they ship with R 4.4.3.*

## 3-Phase Plan

### Phase 1: Get a working install — DONE

**Prerequisites (container/system level):**
1. Bioconductor repos must be configured in `Rprofile.site` (`/usr/local/lib/R/etc/Rprofile.site`)
   so R can find Bioc packages. This is container-local — NOT in the repo. Needs to go into Dockerfile.
   ```r
   options(repos = c(
     CRAN = "https://packagemanager.posit.co/cran/__linux__/jammy/latest",
     BioCsoft = "https://bioconductor.org/packages/3.20/bioc",
     BioCann = "https://bioconductor.org/packages/3.20/data/annotation",
     BioCexp = "https://bioconductor.org/packages/3.20/data/experiment"
   ))
   ```
2. System deps `libmagick++-6.q16-dev` and `libproj-dev` — already added to both Dockerfiles (amd64/arm64)

**R install steps:**

`devtools::install_deps(".", dependencies = TRUE)` reads the `DESCRIPTION` file in the current directory and installs everything in `Imports`, `Depends`, `Suggests`, and `LinkingTo`. It also follows `Remotes` for packages from non-standard sources (GitHub, archive URLs). The `.` just means "current directory" — `DESCRIPTION` is the single source of truth for R dependencies. (System deps like `apt-get` packages are NOT handled by this — those live in the Dockerfile.)

```r
install.packages("devtools")

# Pre-install packages that fail as binaries (binary .so mismatch with system libs)
# NOTE: With PPM Bioconductor config (Phase 1.5), these may no longer be needed.
# Try without first — if magick/proj4 fail, uncomment and rerun.
# install.packages("magick", type = "source", repos = "https://cloud.r-project.org")
# install.packages("proj4", type = "source", repos = "https://cloud.r-project.org")

# Log install output so we can analyze binary vs source installs afterward.
# R prints "installing *binary* package" or "installing *source* package" for each.
# sink() captures this to a file; split = TRUE keeps it printing to console too.
sink("install_log.txt", split = TRUE)
devtools::install_deps(".", dependencies = TRUE, upgrade = "never")
sink()

# After install, check the log:
# grep -c "binary package" install_log.txt   # count binary installs
# grep -c "source package" install_log.txt   # count source installs
# grep "source package" install_log.txt      # see which packages compiled from source

# If anything failed due to lock files or cascading errors, rerun:
# devtools::install_deps(".", dependencies = TRUE)
```

**Issues encountered during first install (2026-03-23):**
| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Rhdf5lib failed → cascaded to QUBIC, runibic, rhdf5, HDF5Array, SpatialExperiment, ReactomePA, GSVA | Stale lock file `00LOCK-Rhdf5lib` | `rm -rf /usr/local/lib/R/site-library/00LOCK-Rhdf5lib` |
| SpatialExperiment failed | Missing `libmagick++-6.q16-dev` system dep | `apt-get install libmagick++-6.q16-dev` |
| magick `.so` load failure | Binary compiled against `.so.8`, system has `.so.9` | Rebuild from source: `install.packages("magick", type="source", repos="https://cloud.r-project.org")` |
| ggalt failed | Archived from CRAN + missing `libproj-dev` | `apt-get install libproj-dev`, rebuild proj4 from source, install ggalt from archive URL |
| biclust failed | Archived from CRAN | Install from archive URL (now in `Remotes`) |
| ottoPlots missing at runtime | Was in `Remotes` but not `Imports` | Added to `Imports` |

Status: **complete** — 0 missing packages, app runs

### Phase 2: Snapshot with renv — NEXT
```r
renv::init()
renv::snapshot()
```
- Captures every package + exact version + source (binary vs source) into `renv.lock`
- Commit `renv.lock` — first time this project has reproducible deps
- `renv.lock` becomes the single source of truth, replacing the table above

### Phase 3: Build `idep-dev-base` image
- Create `Dockerfile.dev-base`: `FROM rocker/shiny-verse:4.4.3` (Ubuntu Jammy)
- Install system deps via `apt-get` (see list above)
- Configure repos: Posit PM + Bioconductor 3.20
- Install R packages via `renv::restore()` from committed `renv.lock`
  - CRAN packages: prebuilt binaries from Posit PM (fast)
  - Bioconductor packages: compiled from source (PPM does NOT serve Bioc binaries — see Phase 1.5 findings)
  - Archived/mismatched packages: from source (tracked in renv.lock)
- Push to Docker Hub as `gexijin/idep-dev-base:4.4.3`
- Update devcontainer Dockerfile: `FROM gexijin/idep-dev-base:4.4.3` + dev tools (Node, Claude, etc.)
- Dev startup goes from ~1 hour to ~1 minute
- Rebuild base image only when deps change

## Issues for Upstream Maintainer
- **Duplicate entries in DESCRIPTION Imports** (pre-existing, not introduced by us):
  - `ggraph` — lines 31 and 72
  - `tidytext` — lines 61 and 73
  - `wordcloud2` — lines 66 and 74
- **Wrong GitHub org in `librarySetup.R`**: `iDEP-SDSU/idep/classes/librarySetup.R` installs idepGolem from `espors/idepGolem` instead of `gexijin/idepGolem` — likely a stale reference to an old org

## PPM for Bioconductor Binaries (Phase 1.5)

**Status**: TESTED (2026-03-24) — PPM does NOT serve Bioconductor binaries. CRAN binaries work, Bioc is source-only.

**What we configured**: Set `BioC_mirror` and `BIOCONDUCTOR_CONFIG_FILE` in `Rprofile.site` so BiocManager resolves repos through PPM instead of bioconductor.org directly.

```r
options(
  BioC_mirror = "https://packagemanager.posit.co/bioconductor/latest",
  BIOCONDUCTOR_CONFIG_FILE = "https://packagemanager.posit.co/bioconductor/latest/config.yaml",
  repos = c(CRAN = "https://packagemanager.posit.co/cran/__linux__/noble/latest")
)
Sys.setenv("R_BIOC_VERSION" = "3.20")
```

**What we found**: PPM's setup page shows a "Binary Packages" option for Ubuntu Noble and claims it will "deliver binary packages compatible with Ubuntu 24.04 (Noble)." However, testing on 2026-03-24 proved this is misleading:

1. **The `__linux__/noble` URL pattern resolves for Bioc** — `https://packagemanager.posit.co/bioconductor/__linux__/noble/latest/packages/3.20/bioc` returns 2,236 packages. But the actual tarballs are identical to the source URL (same MD5, same `.c` files, no compiled `.so` files).
2. **BiocManager doesn't generate `__linux__/noble` URLs anyway** — `BiocManager::repositories()` produces URLs like `.../bioconductor/latest/packages/3.20/bioc` with no OS-specific path segment. Even if PPM did serve binaries, BiocManager wouldn't request them.
3. **PPM admin docs confirm it** — "At this time, Package Manager does not provide binary packages for Bioconductor sources." ([source](https://packagemanager.posit.co/__docs__/admin/serving-binaries.html))
4. **Direct test**: Reinstalled BiocGenerics from both the `__linux__/noble` URL and the standard URL. Both times R reported `"The downloaded source packages are in..."` and ran `R CMD INSTALL` with full compilation. No binary delivery.

**What this means**:
- **CRAN packages**: PPM serves real prebuilt Linux binaries (fast, no compilation)
- **Bioconductor packages**: PPM serves source tarballs only, always compiled from source (~30 packages including DESeq2, limma, GenomicRanges, GO.db, GSVA, etc.)
- The PPM Bioc config is still useful as a convenient mirror, but provides **no speed improvement** over direct bioconductor.org URLs
- **Phase 3 (base Docker image) is the only way to avoid recompiling Bioc packages on every clean build**

**No new system deps needed**: Our ~30 Bioc deps only need libs we already have (`build-essential`, `libglpk-dev`, `libmagick++-6.q16-dev`, `libxml2-dev`, `libssl-dev`, `libcurl4-openssl-dev`).

## Open Questions
- **Jammy vs Noble**: RESOLVED — rocker switched to Noble at R 4.4.2. Posit PM URLs fixed to `noble` in both Dockerfiles. CRAN binaries work correctly. Bioconductor binaries are NOT available from PPM (see Phase 1.5 findings).
- **PPM Bioc binaries**: RESOLVED (2026-03-24) — PPM does not serve them despite the setup UI suggesting otherwise. Bioc packages always compile from source. Phase 3 base image is the only path to faster installs.
- Should `biocViews` packages live only in `Imports`? Duplication works but is messy
- Consolidate with production Docker build in `iDEP-SDSU/idep`?
- Where to host base image? Docker Hub (public) vs GHCR (tied to repo)
