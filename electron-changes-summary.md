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
