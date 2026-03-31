# install_packages.R
# Shared cross-platform package installer using Posit Package Manager snapshots.
# Called by get_r_linux.sh and get_r_windows.ps1.
#
# Usage:  Rscript install_packages.R [library_path]
#   library_path  -- where to install packages (defaults to R's default .libPaths()[1])
#
# Reads dependencies directly from the DESCRIPTION file (including Remotes:
# for archived/GitHub packages), so there is no manual package list to maintain.

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

# ==================== Locate repo root (DESCRIPTION) ====================
# This script lives at <repo>/electron/scripts/install_packages.R.
# Derive the repo root so devtools::install_deps() can read DESCRIPTION.
get_repo_root <- function() {
  cmd_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("--file=", cmd_args, value = TRUE)
  if (length(file_arg) > 0) {
    script_dir <- dirname(normalizePath(sub("--file=", "", file_arg[1])))
    return(normalizePath(file.path(script_dir, "..", "..")))
  }
  # Fallback: assume working directory is the repo root
  getwd()
}

repo_root <- get_repo_root()
cat("Repo root :", repo_root, "\n")

if (!file.exists(file.path(repo_root, "DESCRIPTION"))) {
  stop("Cannot find DESCRIPTION at ", repo_root,
       ". Run this script from the repo root or via Rscript electron/scripts/install_packages.R")
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

# ==================== Install bootstrapping packages ====================
if (!requireNamespace("BiocManager", quietly = TRUE)) {
  install.packages("BiocManager", lib = lib)
}
if (!requireNamespace("pak", quietly = TRUE)) {
  install.packages("pak", lib = lib)
}

# ==================== Install all dependencies from DESCRIPTION ====================
# pak::local_install_deps() reads Imports, Depends, and Remotes from DESCRIPTION.
# Remotes: handles archived/GitHub packages (KEGG.db, biclust, PGSEA, ggalt, ottoPlots).
# Dependency ordering (e.g. biclust before QUBIC) is resolved automatically.
cat("Installing all dependencies from DESCRIPTION ...\n\n")
pak::local_install_deps(root = repo_root, lib = lib, upgrade = FALSE, dependencies = TRUE)

# ==================== Summary ====================
installed <- list.dirs(lib, recursive = FALSE, full.names = FALSE)
cat("\n", length(installed), "packages installed in", lib, "\n")
