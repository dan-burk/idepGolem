# Fix: Linux Electron Package Exit Code 1

## Situation

The Linux Electron build of iDEP crashes immediately on first launch with exit code 1. The app attempts to download the demo database (`data113.tar.gz`) because it is not bundled with the package, but the download fails with "Permission denied" and the app cannot connect to its SQLite database.

The error log shows:

```
[R stderr] [bootstrap] No existing demo data dir at: /opt/iDEP/resources/app/data113
[R stderr] Warning in download.file(...): cannot open destfile 'data113.tar.gz', reason 'Permission denied'
[R stdout] FATAL: Could not connect to database: unable to open database file
[R exit] code=1
```

Three interacting issues cause this failure:

1. **`R/fct_database.R`** downloads `data113.tar.gz` using a bare relative filename (`destfile = file_name`), which resolves to the current working directory.
2. **`R/run_app.R`** falls back to `./data113` (CWD-relative) when the configured `IDEP_DATABASE` path does not yet contain the database, even though that environment variable points to a writable directory chosen by Electron.
3. **`electron/main.js`** bootstrap sets `setwd(app_dir)` to `/opt/iDEP/resources/app` (a read-only installed location), so all CWD-relative writes fail with Permission denied.

A secondary hidden bug: the bootstrap's monkey-patched `untar` skips extraction if `exdir` contains *any* files. Since `exdir` defaults to CWD (which always has files), even if the download had succeeded, the data would never be extracted.

## Task

Fix the first-launch data download flow so that:

- The database tarball downloads to a writable location on all platforms.
- The untar extraction is not incorrectly skipped on first launch.
- Non-Electron environments (dev, Docker, shinyapps.io) are unaffected.

## Action

### 1. `R/fct_database.R` (line 38-47) - Use absolute download path

**Before:** Download destination was the bare filename `data113.tar.gz`, resolved relative to CWD.

**After:** Compute `download_dir` as the parent of `DATAPATH` (which is always the writable data root), download there, and pass `exdir = download_dir` to `untar`.

```r
# Before
download.file(url = ..., destfile = file_name, ...)
untar(file_name)
file.remove(file_name)

# After
download_dir <- normalizePath(
  dirname(sub("/$", "", datapath)), winslash = "/", mustWork = FALSE
)
dir.create(download_dir, recursive = TRUE, showWarnings = FALSE)
dest_file <- file.path(download_dir, file_name)
download.file(url = ..., destfile = dest_file, ...)
untar(dest_file, exdir = download_dir)
file.remove(dest_file)
```

**Why this is an R source change, not just an Electron fix:** The original code assumes CWD is writable, which fails on any read-only deployment (Electron, Docker with read-only root, etc.). Using an absolute path derived from the configured `datapath` is more robust in general.

### 2. `R/run_app.R` (line 46-57) - Don't fall back to read-only CWD when IDEP_DATABASE is set

**Before:** If `orgInfo.db` was not found at the `IDEP_DATABASE`-derived path (because data hasn't been downloaded yet), the code fell back to `file.path(".", db_ver)`, pointing `DATAPATH` at the read-only CWD.

**After:** Only apply the CWD fallback when `IDEP_DATABASE` is not set (i.e., dev environments using relative paths). When `IDEP_DATABASE` is explicitly set, keep `DATAPATH` pointing at the writable location so the subsequent download writes there.

```r
# Before
if (!file.exists(org_info_candidate)) {
  fallback_path <- file.path(".", db_ver)
  DATAPATH <<- ...
}

# After
if (!file.exists(org_info_candidate)) {
  if (nchar(Sys.getenv("IDEP_DATABASE")[1]) == 0) {
    fallback_path <- file.path(".", db_ver)
    DATAPATH <<- ...
  }
}
```

### 3. `electron/main.js` (line 374-381) - Fix patched untar skip logic

**Before:** The monkey-patched `untar` checked if `exdir` (the extraction target directory) had any files at all. Since `exdir` is typically a parent directory containing bootstrap files, port files, etc., this always evaluated to true and skipped extraction on first launch.

**After:** Check specifically for `file.path(exdir, "data113")` — the actual subdirectory the tarball creates. On first launch this directory doesn't exist, so extraction proceeds. On subsequent launches it exists with content, so extraction is correctly skipped.

```r
# Before
if (is_demo_tar && dir.exists(exdir) && length(list.files(exdir, ...)) > 0L)

# After
target_dir <- file.path(exdir, "data113")
if (is_demo_tar && dir.exists(target_dir) && length(list.files(target_dir, ...)) > 0L)
```

## Result

**First launch flow with fixes:**

1. Electron sets `IDEP_DATABASE=/home/daniel/idep` (writable), spawns R with `cwd=/home/daniel/idep`.
2. Bootstrap runs `setwd("/opt/iDEP/resources/app")` for app file resolution.
3. `run_app.R` sets `DATAPATH=/home/daniel/idep/data113/` from `IDEP_DATABASE`. Database doesn't exist yet, but `IDEP_DATABASE` is set so no CWD fallback occurs.
4. `connect_convert_db()` sees `orgInfo.db` missing, triggers download.
5. `download_dir` resolves to `/home/daniel/idep` (writable). Download succeeds.
6. Patched `untar` checks `/home/daniel/idep/data113` (doesn't exist yet) and proceeds with extraction.
7. `data113/` is created at `/home/daniel/idep/data113/`, database connects successfully.

**Second launch:** `orgInfo.db` exists at `/home/daniel/idep/data113/demo/orgInfo.db`, no download triggered.

**Non-Electron environments:** `IDEP_DATABASE` is unset, so the CWD fallback path is unchanged. No behavioral difference for dev, Docker, or shinyapps.io deployments.

### Files changed

| File | Change |
|---|---|
| `R/fct_database.R` | Use absolute path for download and untar based on `datapath` |
| `R/run_app.R` | Skip CWD fallback when `IDEP_DATABASE` env var is set |
| `electron/main.js` | Patched `untar` checks `data113/` subdirectory, not parent dir |
