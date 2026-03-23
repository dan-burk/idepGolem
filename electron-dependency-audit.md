# Electron Build Dependency Audit

## Problem

The Electron CI workflows (`.github/workflows/build-electron-*.yml`) install R packages
using their own custom logic — they parse `DESCRIPTION` directly and split packages into
CRAN vs Bioconductor using a **hardcoded list**. They do NOT use `devtools::install_deps()`
and therefore ignore the `Remotes` and `biocViews` fields entirely.

After the devcontainer overhaul (commit `a642044`), `DESCRIPTION` now correctly declares
all dependencies in `Imports`. This exposed gaps in the Electron workflow that were
previously hidden because many packages lived only in `biocViews` (which the workflow skips).

## How the Electron workflow installs deps

From `build-electron-linux.yml` lines ~233–259 (Windows/macOS are similar):

```r
# Parses Depends + Imports from DESCRIPTION
pkgs <- unique(c(parse_field("Depends"), parse_field("Imports")))

# Hardcoded Bioc list — anything NOT here goes to install.packages()
bioc_pkgs <- intersect(pkgs, c(
  "DESeq2","edgeR","ComplexHeatmap","GSVA","gage",
  "hgu133plus2.db","InteractiveComplexHeatmap","PCAtools",
  "pathview","QUBIC","fgsea","WGCNA",
  "GO.db","SummarizedExperiment","Biobase",
  "limma","KEGGREST","preprocessCore"
))
cran_pkgs <- setdiff(pkgs, bioc_pkgs)

install.packages(cran_pkgs, ...)        # tries CRAN for everything else
BiocManager::install(bioc_pkgs, ...)     # only the hardcoded ones
```

Special cases handled:
- `ggalt` — archived CRAN, installed via `remotes::install_version("ggalt", "0.4.0")`
- `ottoPlots` — installed from GitHub in a separate step before DESCRIPTION parsing
- `GSVA` — second retry pass if first Bioc install fails

## Packages that fall through the cracks

### Bioconductor packages missing from the hardcoded list

These are now in `Imports` but NOT in the workflow's `bioc_pkgs` intersect list.
The workflow will try `install.packages()` on them, which fails silently because
they're not on CRAN.

| Package | Status | Risk |
|---------|--------|------|
| BiocGenerics | Bioc core | Low — transitive dep of DESeq2/edgeR, already installed |
| GenomicRanges | Bioc core | Low — transitive dep of DESeq2 |
| IRanges | Bioc core | Low — transitive dep of DESeq2 |
| S4Vectors | Bioc core | Low — transitive dep of DESeq2 |
| ReactomePA | Bioc 3.20 | **Medium** — may not be pulled in transitively |
| runibic | Bioc 3.20 | **Medium** — may not be pulled in transitively |
| BiocManager | Actually CRAN | None — `install.packages()` works fine |

**Fix:** Add these to the hardcoded `bioc_pkgs` list in all three workflow files.

### Annotation databases (org.*.db) — 18 packages

These were previously in `biocViews` only (workflow ignored them). Now they're in `Imports`.
None are on CRAN. None are in the hardcoded Bioc list.

```
org.Ag.eg.db, org.At.tair.db, org.Bt.eg.db, org.Ce.eg.db, org.Cf.eg.db,
org.Dm.eg.db, org.Dr.eg.db, org.EcK12.eg.db, org.EcSakai.eg.db, org.Gg.eg.db,
org.Hs.eg.db, org.Mm.eg.db, org.Mmu.eg.db, org.Pt.eg.db, org.Rn.eg.db,
org.Sc.sgd.db, org.Ss.eg.db, org.Xl.eg.db
```

**Impact:** These are large (~30-80 MB each). Installing all 18 adds 500MB+ to the
Electron bundle. They were never in the Electron build before — species-specific
analysis features were likely broken in the desktop app.

**Fix options:**
1. Add all to the hardcoded Bioc list (correct but bloats the bundle)
2. Move org.*.db to `Suggests` in DESCRIPTION and load them conditionally at runtime
   (smaller bundle, but requires code changes to handle missing annotation DBs gracefully)
3. Download on first use in the Electron app (best UX, most work)

### Archived packages with no special handling

| Package | Source | Current handling |
|---------|--------|-----------------|
| biclust 2.0.3.1 | CRAN archive | **None** — `install.packages("biclust")` silently fails |
| PGSEA 1.60.0 | Bioc 3.10 archive | **None** — not on CRAN or current Bioc |
| KEGG.db 2.8.0 | Bioc 2.11 archive | **None** — not on CRAN or current Bioc |

**Note:** `biclust` was in `Imports` before our changes too — this was already broken.

**Fix:** Add special-case installs like the existing `ggalt` handling:
```r
# biclust — archived from CRAN
if (!"biclust" %in% rownames(installed.packages(lib.loc=lib))) {
  remotes::install_version("biclust", version="2.0.3.1", lib=lib, upgrade="never")
}

# PGSEA — archived from Bioconductor
if (!"PGSEA" %in% rownames(installed.packages(lib.loc=lib))) {
  remotes::install_url(
    "https://bioconductor.org/packages/3.10/bioc/src/contrib/PGSEA_1.60.0.tar.gz",
    lib=lib, upgrade="never"
  )
}

# KEGG.db — archived Bioconductor annotation
if (!"KEGG.db" %in% rownames(installed.packages(lib.loc=lib))) {
  remotes::install_url(
    "http://www.bioconductor.org/packages//2.11/data/annotation/src/contrib/KEGG.db_2.8.0.tar.gz",
    lib=lib, upgrade="never"
  )
}
```

## What's NOT affected

| Component | Why it's safe |
|-----------|---------------|
| **Production Docker** (iDEP-SDSU/idep) | Completely separate repo, separate build |
| **devtools::install_deps()** (dev workflow) | Reads `Remotes` — our changes actually fixed this path |
| **Rprofile.site** | Container-local, not in Electron builds |
| **Devcontainer Dockerfiles** | Only affect dev environment |

## Suggested fix strategy

### Option A: Update workflows to match DESCRIPTION (minimal)

1. Expand the hardcoded `bioc_pkgs` list in all 3 workflow files to include:
   `BiocGenerics, GenomicRanges, IRanges, S4Vectors, ReactomePA, runibic` + all `org.*.db`
2. Add special-case installs for `biclust`, `PGSEA`, `KEGG.db` (like existing `ggalt` handling)
3. Update the critical package verification list

### Option B: Replace hardcoded logic with `devtools::install_deps()` (cleaner)

Replace the entire custom install script with:
```r
# Configure Bioc repos
options(repos = BiocManager::repositories())
devtools::install_deps(desc_path, dependencies = TRUE, lib = lib)

# Source overrides for system lib mismatches
install.packages("magick", type = "source", lib = lib)
install.packages("proj4", type = "source", lib = lib)
```

This leverages `Remotes` for archived packages, auto-detects Bioc vs CRAN, and stays
in sync with DESCRIPTION without manual hardcoding. Downside: `install_deps()` may
pull in more transitive deps, increasing bundle size.

### Option C: Move large optional deps to `Suggests` (smallest bundle)

Move org.*.db and other organism-specific packages to `Suggests` in DESCRIPTION.
Update R code to check for their presence before loading. This keeps the Electron
bundle lean and avoids installing 500MB+ of annotation databases that most desktop
users won't need for all 18 organisms.

## Files to modify

All three workflows follow the same pattern and need the same fixes:
- `.github/workflows/build-electron-linux.yml` (lines ~248-258)
- `.github/workflows/build-electron-windows.yml` (equivalent section)
- `.github/workflows/build-electron-mac.yml` (equivalent section + has its own ggalt patch for macOS)
