# install_packages.R
# Shared cross-platform package installer using Posit Package Manager snapshots.
# Called by get_r_linux.sh and get_r_windows.ps1.
#
# Usage:  Rscript install_packages.R [library_path]
#   library_path  -- where to install packages (defaults to R's default .libPaths()[1])

# ==================== Configuration ====================
# CRAN and Bioconductor have separate snapshot calendars on PPM.
# Bioc 3.21 (for R 4.5.x) last available snapshot: 2025-10-17.
# CRAN snapshots are available through the current date.
CRAN_SNAPSHOT_DATE <- "2026-03-31"
BIOC_SNAPSHOT_DATE <- "2025-10-17"
BIOC_VERSION <- "3.21" # Bioconductor version for R 4.5.x

# ==================== Library path ====================
args <- commandArgs(trailingOnly = TRUE)
if (length(args) >= 1 && nzchar(args[1])) {
  lib <- args[1]
  if (!dir.exists(lib)) dir.create(lib, recursive = TRUE)
  .libPaths(c(lib, .libPaths()))
  cat("Installing to library:", lib, "\n")
} else {
  lib <- .libPaths()[1]
  cat("Installing to default library:", lib, "\n")
}

# ==================== Set up PPM repos ====================
cran_url <- paste0("https://packagemanager.posit.co/cran/", CRAN_SNAPSHOT_DATE)

# On Linux, use the __linux__ URL variant for prebuilt binaries
if (.Platform$OS.type == "unix" && Sys.info()["sysname"] == "Linux") {
  codename <- tryCatch(
    trimws(system("lsb_release -cs", intern = TRUE)),
    error = function(e) "noble"
  )
  cran_url <- paste0(
    "https://packagemanager.posit.co/cran/__linux__/", codename, "/",
    CRAN_SNAPSHOT_DATE
  )
}

bioc_url <- paste0(
  "https://packagemanager.posit.co/bioconductor/", BIOC_SNAPSHOT_DATE
)

options(
  repos = c(CRAN = cran_url),
  BioC_mirror = bioc_url,
  BIOCONDUCTOR_CONFIG_FILE = paste0(bioc_url, "/config.yaml"),
  timeout = 300,
  warn = 1
)
Sys.setenv("R_BIOC_VERSION" = BIOC_VERSION)

cat("CRAN repo :", cran_url, "\n")
cat("BioC mirror:", bioc_url, "\n")
cat("BioC version:", BIOC_VERSION, "\n\n")

# ==================== Install BiocManager ====================
if (!requireNamespace("BiocManager", quietly = TRUE)) {
  install.packages("BiocManager", lib = lib)
}

# ==================== Package list ====================
# Everything from DESCRIPTION Imports, excluding base R (stats, utils,
# graphics, grDevices, grid) and the 5 archived/GitHub packages handled below.
# BiocManager::install() resolves both CRAN and Bioconductor transparently.
packages <- c(
  # CRAN
  "bslib", "circlize", "colorspace", "config", "data.table", "DBI",
  "dendextend", "dplyr", "DT", "dynamicTreeCut", "e1071", "factoextra",
  "flashClust", "GetoptLong", "ggplot2", "ggpubr", "ggraph", "ggrepel",
  "ggupset", "golem", "hexbin", "igraph", "kableExtra", "knitr",
  "pkgload", "plotly", "png", "purrr", "R.utils", "RColorBrewer",
  "readxl", "remotes", "reshape2", "rmarkdown", "RSQLite", "Rtsne",
  "shiny", "shinyAce", "shinyBS", "shinybusy", "shinyjs", "stringr",
  "tidyr", "tidyselect", "tidytext", "tippy", "visNetwork", "WGCNA",
  "wordcloud2",
  # Dependencies of archived packages (not auto-resolved with repos=NULL)
  "flexclust", "additivityTests",       # biclust deps
  "proj4", "ash", "maps", "extrafont",  # ggalt deps
  # Bioconductor
  "Biobase", "BiocGenerics", "ComplexHeatmap", "DESeq2", "edgeR",
  "fgsea", "gage", "GenomicRanges", "GO.db", "GSVA",
  "hgu133plus2.db", "InteractiveComplexHeatmap", "IRanges", "KEGGREST",
  "limma", "pathview", "PCAtools", "preprocessCore",
  "ReactomePA", "S4Vectors", "SummarizedExperiment",
  "annaffy",                             # PGSEA dep
  # Organism annotation databases
  "org.Ag.eg.db", "org.At.tair.db", "org.Bt.eg.db", "org.Ce.eg.db",
  "org.Cf.eg.db", "org.Dm.eg.db", "org.Dr.eg.db", "org.EcK12.eg.db",
  "org.EcSakai.eg.db", "org.Gg.eg.db", "org.Hs.eg.db", "org.Mm.eg.db",
  "org.Mmu.eg.db", "org.Pt.eg.db", "org.Rn.eg.db", "org.Sc.sgd.db",
  "org.Ss.eg.db", "org.Xl.eg.db"
)

cat("Installing", length(packages), "packages (CRAN:", CRAN_SNAPSHOT_DATE,
    "/ BioC:", BIOC_SNAPSHOT_DATE, ")\n\n")
BiocManager::install(packages, lib = lib, update = FALSE, ask = FALSE)

# ==================== Archived / GitHub packages ====================
# These are no longer on CRAN/Bioconductor and must be installed from
# their archive URLs. Matches the Remotes: field in DESCRIPTION.
archived <- c(
  # Order matters: KEGG.db must come before PGSEA, biclust before QUBIC/runibic
  KEGG.db = "http://www.bioconductor.org/packages//2.11/data/annotation/src/contrib/KEGG.db_2.8.0.tar.gz",
  biclust = "https://cran.r-project.org/src/contrib/Archive/biclust/biclust_2.0.3.1.tar.gz",
  PGSEA   = "https://bioconductor.org/packages/3.10/bioc/src/contrib/PGSEA_1.60.0.tar.gz",
  ggalt   = "https://cran.r-project.org/src/contrib/Archive/ggalt/ggalt_0.4.0.tar.gz"
)

for (pkg in names(archived)) {
  cat("\nInstalling archived package:", pkg, "\n")
  install.packages(archived[[pkg]], lib = lib, repos = NULL, type = "source")
}

# Bioconductor packages that depend on archived packages (biclust)
# Must be installed after biclust is available.
cat("\nInstalling Bioc packages that depend on archived biclust ...\n")
BiocManager::install(c("QUBIC", "runibic"), lib = lib, update = FALSE, ask = FALSE)

# GitHub packages
cat("\nInstalling ottoPlots from GitHub ...\n")
remotes::install_github("espors/ottoPlots", lib = lib, upgrade = "never")

# ==================== Summary ====================
installed <- list.dirs(lib, recursive = FALSE, full.names = FALSE)
cat("\n", length(installed), "packages installed in", lib, "\n")
