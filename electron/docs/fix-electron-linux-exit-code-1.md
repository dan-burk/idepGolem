# Fix: Electron Exit Code 1 (Windows + Linux)

## Situation

The Electron build of iDEP crashes on launch with exit code 1. Two separate bugs cause this:

**Bug 1 — "file name is missing" (Windows + Linux):**
Commit `656501c` changed the Rscript spawn from a positional argument to `--file=` concatenation. If the bootstrap path has issues (spaces, empty value), Rscript prints "file name is missing" and exits with code 1.

**Bug 2 — "Permission denied" on database download (Linux only):**
The bootstrap script runs `setwd(app_dir)`, setting CWD to the read-only install directory (`/opt/iDEP/resources/app`). The R source code (`fct_database.R`, `run_app.R`) downloads and extracts the database relative to CWD. On a server this works because CWD is writable. On Linux Electron, CWD is read-only, so the download fails with "Permission denied."

**Bug 3 — Patched `untar` always skips extraction on first launch:**
The bootstrap's monkey-patched `untar` checks if `exdir` (which defaults to CWD) contains any files. CWD always contains files, so extraction is always skipped — even on first launch when the database hasn't been extracted yet.

### Key insight

The original `main.js` (created by Raghavi, Nov 2025) set `setwd(app_dir)` in the bootstrap. This was unnecessary — nothing in the R package requires CWD to be the app install directory. Golem resolves paths through `app_sys()` / `system.file()`, packages load via `.libPaths()`, and Shiny doesn't care about CWD. The `setwd` only served to make CWD read-only, breaking all CWD-relative writes.

The R source code (`fct_database.R`, `run_app.R`) relies on CWD being writable for downloads and the fallback path. Rather than modifying the R source (which serves the deployed web app, Docker, and dev environments), the fix keeps all changes in the Electron layer (`main.js`) where the problem originates. This gives clean separation of concerns — Electron fixes stay in Electron, R source stays untouched.

## Task

Fix the Electron first-launch flow so that:

- Rscript receives the bootstrap path correctly (fixes Windows + Linux crash)
- CWD is a writable directory so existing R download logic works (fixes Linux)
- The patched `untar` correctly detects first launch vs. subsequent launches
- Zero changes to R source code — non-Electron environments are completely unaffected

## Action — All changes in `electron/main.js` only

### 1. Revert Rscript spawn to positional argument (line ~473)

**Before:** `spawn(rscript, ['--vanilla', '--file=' + bootstrapPath], { ... })`

**After:** `spawn(rscript, ['--vanilla', bootstrapPath], { ... })`

Rscript expects the script path as a positional argument. The `--file=` concatenation was introduced in commit `656501c` and broke both platforms.

### 2. Change `setwd(app_dir)` to `setwd(data_dir)` (line ~417 in bootstrap)

**Before:** `setwd(app_dir)` — sets CWD to the read-only install directory (e.g., `/opt/iDEP/resources/app`)

**After:** `setwd(data_dir)` — sets CWD to the writable user data directory (e.g., `/home/user/idep`)

This is the root cause fix. `data_dir` is the writable directory that `main.js` already creates and passes as `IDEP_DATABASE`. By making it CWD, all existing CWD-relative operations in the R source code (downloading, untarring, the `./data113` fallback) land in a writable location.

Nothing in the R package requires CWD to be the app directory:
- `getwd()` calls in `mod_02`, `mod_03`, `mod_04`, `mod_06` are for report `knit_root_dir` — they just need a writable directory
- `fct_06_pathway.R` uses `getwd()` for a log message only
- Package loading uses `.libPaths()`, not CWD
- Golem uses `app_sys()`, not CWD

### 3. Fix patched `untar` skip logic (line ~374-381 in bootstrap)

**Before:** Checks if `exdir` (the parent directory, typically CWD) has any files:
```r
is_demo_tar <- grepl("data113", basename(tarfile), fixed = TRUE)
if (is_demo_tar && dir.exists(exdir) && length(list.files(exdir, recursive = TRUE)) > 0L)
```

**After:** Checks if the specific `data113/` subdirectory exists inside `exdir`:
```r
is_demo_tar <- grepl("data113", basename(tarfile), fixed = TRUE)
target_dir <- file.path(exdir, "data113")
if (is_demo_tar && dir.exists(target_dir) && length(list.files(target_dir, recursive = TRUE)) > 0L)
```

On first launch, `data113/` doesn't exist → extraction proceeds. On subsequent launches, `data113/` exists with content → extraction is correctly skipped.

### Files changed

| File | Change |
|---|---|
| `electron/main.js` | Revert Rscript spawn to positional argument |
| `electron/main.js` | `setwd(app_dir)` → `setwd(data_dir)` |
| `electron/main.js` | Patched `untar` checks `data113/` subdirectory, not parent dir |
| `R/fct_database.R` | No changes |
| `R/run_app.R` | No changes |

---

## Detailed Walkthrough: Before, Why It Broke, After, Why It Works

### How it worked BEFORE Electron existed (deployed web app)

The app runs on a server. `IDEP_DATABASE` is not set in the server's environment. The database sits at `./data113/` relative to where the app runs.

1. **`run_app.R:26`** — `data_root = Sys.getenv("IDEP_DATABASE")` → returns empty string `""`
2. **`run_app.R:28-29`** — `nchar("") == 0` is true → `data_root = "../../data"`
3. **`run_app.R:40-43`** — `DATAPATH = "../../data/data113/"`
4. **`run_app.R:44`** — Checks for `../../data/data113/demo/orgInfo.db` — doesn't exist on a fresh dev setup
5. **`run_app.R:46-53`** — Fallback runs: `DATAPATH = "./data113/"`
6. **`run_app.R:44`** — Checks for `./data113/demo/orgInfo.db` — if it exists, done. If not...
7. **`fct_database.R:25`** — `org_info_file` doesn't exist → enters download block
8. **`fct_database.R:38-47`** — Downloads `data113.tar.gz` to CWD (`.`), untars to CWD (`.`), creates `./data113/`
9. **Works** because CWD is a normal writable server directory

**This flow is completely unaffected by our changes. We touch zero R source files.**

### Why it FAILED on Electron

`main.js` spawns R and passes `IDEP_DATABASE=/home/user/idep` in the environment (a writable user directory). But the bootstrap script runs `setwd(app_dir)` — pointing CWD at the read-only install directory.

#### Bug 1 — "file name is missing" (Windows + Linux):

1. `main.js` spawns `Rscript --vanilla --file=/path/to/bootstrap.R`
2. Rscript doesn't parse `--file=` correctly in this context → prints "file name is missing" → exit code 1
3. App never starts

#### Bug 2 — "Permission denied" (Linux, if Bug 1 were fixed):

1. **`run_app.R:26`** — `data_root = Sys.getenv("IDEP_DATABASE")` → returns `"/home/user/idep"`
2. **`run_app.R:28-29`** — `nchar("/home/user/idep") == 0` is false → skip, `data_root` stays `"/home/user/idep"`
3. **`run_app.R:40-43`** — `DATAPATH = "/home/user/idep/data113/"`
4. **`run_app.R:44`** — Checks for `/home/user/idep/data113/demo/orgInfo.db` — doesn't exist (first launch)
5. **`run_app.R:46-53`** — Fallback runs: `DATAPATH = "./data113/"` — but `.` is `/opt/iDEP/resources/app/` (read-only!) because `setwd(app_dir)` made it so
6. **`fct_database.R:25`** — `org_info_file` doesn't exist → enters download block
7. **`fct_database.R:38-42`** — Tries to download `data113.tar.gz` to CWD → `/opt/iDEP/resources/app/`
8. **Permission denied.** Read-only directory. App crashes, exit code 1.

#### Bug 3 — Even if download succeeded, untar would be skipped:

1. `untar("data113.tar.gz")` is called → patched `untar` intercepts
2. `exdir` defaults to `"."` (CWD) which has files in it (bootstrap, port file, logs, etc.)
3. `length(list.files(".", recursive = TRUE)) > 0L` → TRUE → **extraction skipped**
4. Database never extracted even though tarball was downloaded

### How it works NOW (all fixes in `main.js` only)

#### Windows Electron:

1. `main.js` spawns `Rscript --vanilla /path/to/bootstrap.R` (positional arg — **fix 1**)
2. Bootstrap runs `setwd(data_dir)` → CWD = `C:\Users\dburk\AppData\Local\Programs\idepGolem\idep` (writable — **fix 2**)
3. **`run_app.R:26`** — `data_root = Sys.getenv("IDEP_DATABASE")` → returns `C:\Users\dburk\...\idep`
4. **`run_app.R:40-44`** — `DATAPATH = C:/.../idep/data113/`, checks for `orgInfo.db` — doesn't exist (first launch)
5. **`run_app.R:46-53`** — Fallback runs: `DATAPATH = "./data113/"` → resolves to `C:\Users\dburk\...\idep\data113\` — **writable** because CWD is the writable data dir
6. **`fct_database.R:25`** — `org_info_file` doesn't exist → enters download block
7. **`fct_database.R:38-47`** — Downloads `data113.tar.gz` to CWD (writable), untars to CWD, creates `./data113/`
8. Patched `untar` checks `file.path(".", "data113")` — doesn't exist yet → **extraction proceeds** (**fix 3**)
9. **App starts.**

#### Linux Electron, first launch:

1. `main.js` spawns `Rscript --vanilla /path/to/bootstrap.R` (positional arg — **fix 1**)
2. Bootstrap runs `setwd(data_dir)` → CWD = `/home/user/idep` (writable — **fix 2**)
3. **`run_app.R:26`** — `data_root = Sys.getenv("IDEP_DATABASE")` → returns `"/home/user/idep"`
4. **`run_app.R:28-29`** — `nchar("/home/user/idep") == 0` is false → skip, `data_root` stays `"/home/user/idep"`
5. **`run_app.R:40-43`** — `DATAPATH = "/home/user/idep/data113/"`
6. **`run_app.R:44`** — Checks for `/home/user/idep/data113/demo/orgInfo.db` — doesn't exist (first launch)
7. **`run_app.R:46-53`** — Fallback runs: `DATAPATH = "./data113/"` → resolves to `/home/user/idep/data113/` — **writable** because CWD is the writable data dir
8. **`fct_database.R:25`** — `org_info_file` doesn't exist → enters download block
9. **`fct_database.R:38`** — `file_name = "data113.tar.gz"`
10. **`fct_database.R:40-45`** — Downloads to CWD → `/home/user/idep/data113.tar.gz` — **succeeds**
11. **`fct_database.R:46`** — `untar("data113.tar.gz")` → patched `untar` intercepts
12. Patched `untar` checks `file.path(".", "data113")` → `/home/user/idep/data113` — doesn't exist yet → **extraction proceeds** (**fix 3**)
13. Creates `/home/user/idep/data113/` with all database files
14. **`fct_database.R:47`** — Deletes `data113.tar.gz`
15. **`fct_database.R:55-59`** — Connects to `/home/user/idep/data113/demo/orgInfo.db` — **app starts**

#### Second launch (any platform):

1. Bootstrap runs, `setwd(data_dir)`
2. `run_app.R` resolves `DATAPATH`, finds `orgInfo.db` exists → no fallback needed
3. `fct_database.R` sees `org_info_file` exists → no download needed
4. **App starts immediately.**

#### Deployed web/Docker (no Electron, no changes):

1. **`run_app.R:26`** — `Sys.getenv("IDEP_DATABASE")` → returns `""` (not set)
2. Falls through to `data_root = "../../data"`, then fallback to `./data113/`
3. Database already exists → connects directly
4. **No change in behavior whatsoever. Zero R source files were modified.**

### Why it will work

- **Fix 1 (positional arg):** Rscript has always accepted the script path as a positional argument. The `--file=` concatenation was an unnecessary change in commit `656501c` that broke argument parsing. Reverting restores the working behavior.

- **Fix 2 (`setwd(data_dir)`):** This is the root cause fix. The original `setwd(app_dir)` pointed CWD at a read-only install directory, which broke all CWD-relative writes in the R source. Changing to `setwd(data_dir)` points CWD at the writable user data directory that Electron already creates. The existing R code (fallback to `./data113`, download to CWD, untar to CWD) all works correctly when CWD is writable. No R source changes needed.

- **Fix 3 (untar skip logic):** The patched `untar` now checks for the specific `data113/` subdirectory instead of any files in the parent directory. This correctly distinguishes first launch (no `data113/` yet, proceed with extraction) from subsequent launches (`data113/` exists, skip extraction).

All three fixes are in `electron/main.js`. The R source code is untouched. Non-Electron environments are completely unaffected.
