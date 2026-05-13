# bootstrap.R — Electron bootstrap for iDEP Shiny app
#
# Launched by main.js via: Rscript --vanilla bootstrap.R
# All configuration is passed via environment variables set by main.js.
# This file is shipped read-only inside the app package.

data_dir <- Sys.getenv("IDEP_DATA_DIR", unset = getwd())
app_dir  <- Sys.getenv("IDEP_APP_DIR",  unset = ".")
lib_dir  <- Sys.getenv("R_LIBS_USER",   unset = file.path(Sys.getenv("R_HOME", "."), "library"))
host     <- Sys.getenv("IDEP_HOST", unset = "127.0.0.1")
port     <- as.integer(Sys.getenv("IDEP_PORT", unset = "7777"))
demo_dir_hint <- Sys.getenv("IDEP_DEMO_DIR", unset = file.path(app_dir, "data113"))

.libPaths(unique(c(normalizePath(lib_dir, winslash = "/", mustWork = FALSE), .libPaths())))
options(shiny.launch.browser = FALSE, golem.app.prod = TRUE)

# ------------------------------------------------------------------------------
# Avoid re-downloading the large demo tarball every launch.
# We cache it under data_dir and reuse it if available.
# ------------------------------------------------------------------------------
cache_tar <- file.path(data_dir, "data113_cache.tar.gz")
demo_url  <- "http://bioinformatics.sdstate.edu/data/data113/data113.tar.gz"

try({
  ns_utils <- asNamespace("utils")
  orig_download_file <- get("download.file", envir = ns_utils)

  patched_download <- function(url, destfile, ...) {
    if (identical(url, demo_url) && file.exists(cache_tar)) {
      message("[bootstrap] Using cached demo tarball: ", cache_tar)
      dir.create(dirname(destfile), recursive = TRUE, showWarnings = FALSE)
      file.copy(cache_tar, destfile, overwrite = TRUE)
      return(0L)
    }

    status <- orig_download_file(url, destfile, ...)

    if (identical(url, demo_url) && identical(status, 0L) && file.exists(destfile)) {
      dir.create(dirname(cache_tar), recursive = TRUE, showWarnings = FALSE)
      if (file.copy(destfile, cache_tar, overwrite = TRUE)) {
        message("[bootstrap] Cached demo tarball at: ", cache_tar)
      }
    }

    status
  }

  unlockBinding("download.file", ns_utils)
  assign("download.file", patched_download, envir = ns_utils)
  lockBinding("download.file", ns_utils)
}, silent = TRUE)

# ------------------------------------------------------------------------------
# Avoid re-untarring the demo tarball if data113 already exists and has content.
# ------------------------------------------------------------------------------
try({
  ns_utils2 <- asNamespace("utils")
  orig_untar <- get("untar", envir = ns_utils2)

  patched_untar <- function(tarfile, files = NULL, list = FALSE,
                            exdir = ".", compressed = NA,
                            extras = NULL, verbose = getOption("verbose")) {

    is_demo_tar <- grepl("data113", basename(tarfile), fixed = TRUE)
    target_dir <- file.path(exdir, "data113")

    if (is_demo_tar &&
        dir.exists(target_dir) &&
        length(list.files(target_dir, recursive = TRUE)) > 0L) {
      message("[bootstrap] Skipping untar for demo data; existing files in: ", target_dir)
      return(invisible(character()))
    }

    orig_untar(tarfile,
               files = files,
               list  = list,
               exdir = exdir,
               compressed = compressed,
               extras = extras,
               verbose = verbose)
  }

  unlockBinding("untar", ns_utils2)
  assign("untar", patched_untar, envir = ns_utils2)
  lockBinding("untar", ns_utils2)
}, silent = TRUE)

# Optional: still log whether we see a pre-extracted demo_dir
if (dir.exists(demo_dir_hint) && length(list.files(demo_dir_hint, recursive = TRUE)) > 0L) {
  options(idep.demo_data_dir = demo_dir_hint)
  message("[bootstrap] Existing demo data dir detected at: ", demo_dir_hint)
} else {
  message("[bootstrap] No existing demo data dir at: ", demo_dir_hint)
}

# log
logfile <- file.path(data_dir, "electron_r.log")
try({
  zz <- file(logfile, open = "a+", encoding = "UTF-8")
  sink(zz, type = "output", split = TRUE)
  sink(zz, type = "message", split = TRUE)
}, silent = TRUE)

# inform Electron about port
writeLines(as.character(port), file.path(data_dir, "idep_port.txt"))

setwd(data_dir)
ok <- TRUE
startup_t0 <- Sys.time()

tryCatch({
  pkg_t0 <- Sys.time()
  if (!requireNamespace("idepGolem", quietly = TRUE)) {
    stop("Package 'idepGolem' not found in vendored library: ", paste(.libPaths(), collapse = " | "))
  }
  pkg_t1 <- Sys.time()
  message("[bootstrap] Package load time: ", round(as.numeric(difftime(pkg_t1, pkg_t0, units = "secs")), 2), " s")

  app_t0 <- Sys.time()
  app <- idepGolem::run_app()
  if (!inherits(app, "shiny.appobj")) stop("run_app() did not return a shiny.appobj")
  app_t1 <- Sys.time()
  message("[bootstrap] run_app() time: ", round(as.numeric(difftime(app_t1, app_t0, units = "secs")), 2), " s")

  shiny_t0 <- Sys.time()
  shiny::runApp(app, host = host, port = port, launch.browser = FALSE)
  shiny_t1 <- Sys.time()
  message("[bootstrap] shiny::runApp() returned after ",
          round(as.numeric(difftime(shiny_t1, shiny_t0, units = "secs")), 2), " s")
}, error = function(e) {
  ok <<- FALSE
  cat("FATAL:", conditionMessage(e), "\n")
}, finally = {
  startup_t1 <- Sys.time()
  message("[bootstrap] Total R-side startup time: ",
          round(as.numeric(difftime(startup_t1, startup_t0, units = "secs")), 2), " s")
  try({ sink(type = "message"); sink(type = "output") }, silent = TRUE)
})

quit(status = if (ok) 0L else 1L, save = "no")
