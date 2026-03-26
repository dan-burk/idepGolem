# renv bug report: `renv_description_parse_field()` fails on non-repository packages

**renv version:** 1.2.0 (install.packages installs latest; also affects 1.1.8)
**R version:** 4.5.1
**OS:** Ubuntu 24.04 (Noble)

---

## Summary

`renv::restore()` crashes with `'length = N' in coercion to 'logical(1)'` when the lockfile contains non-repository packages (URL, GitHub, GitLab) whose `Depends` or `Imports` fields are stored as JSON arrays — the default format that `renv::snapshot()` writes.

The bug affects **any** non-repository source: `"Source": "URL"`, `"Source": "GitHub"`, `"Source": "GitLab"`, etc. CRAN and Bioconductor packages are not affected because renv looks up their metadata from the repository instead of using the lockfile record directly.

---

## Existing upstream issue

This was independently reported as [rstudio/renv#2249](https://github.com/rstudio/renv/issues/2249) on 2026-03-25 by `devinrkeane`, who encountered the same crash with GitLab URL-sourced packages (`'length = 39'`).

### Root cause identified in #2249

The issue author diagnosed two interrelated problems:

1. **Primary**: When a package has `RemoteSubdir: ""` (empty string) in the lockfile, the DESCRIPTION file URL is constructed incorrectly in `R/graph.R` (line 352) and `R/remotes.R` (line 883). The code `parts <- c(subdir, "DESCRIPTION")` with empty `subdir` produces `"/DESCRIPTION"` which URL-encodes to `%2FDESCRIPTION`, resulting in an invalid URL.

2. **Secondary crash**: The DESCRIPTION download silently fails, then the lockfile's list-valued fields get merged into the empty description. When `renv_description_parse_field()` receives a multi-element value, `is.null(field) || is.na(field)` crashes because `is.na()` on a list/vector returns a vector, and `||` requires a scalar.

### Fix status

Kevin Ushey (renv maintainer) acknowledged and fixed the primary cause within hours in commit `88ceeea` (2026-03-25T22:17:32Z):

```r
# Before (broken):
parts <- c(subdir, "DESCRIPTION")

# After (fixed):
parts <- c(if (nzchar(subdir %||% "")) subdir, "DESCRIPTION")
```

**However, this fix is NOT in renv 1.2.0.** The timeline:

| Event | Timestamp |
|-------|-----------|
| renv 1.2.0 released to CRAN | 2026-03-25T15:55:33Z |
| Fix committed to `main` | 2026-03-25T22:17:32Z |

The fix missed the 1.2.0 release by ~6 hours and will presumably ship in 1.2.1.

### `renv_description_parse_field` itself remains unhardened

The fix only addressed the root cause (bad URL from empty `RemoteSubdir`), not the secondary crash. On `main`, the function still contains the unsafe pattern:

```r
if (is.null(field) || is.na(field) || !nzchar(field))
```

If a multi-element field reaches this function through any other code path (e.g., GitHub packages without a `GITHUB_PAT`), the same crash occurs.

---

## Detailed mechanism (our analysis)

### The crash flow

1. `renv_graph_resolve()` calls `renv_graph_description(record)` to fetch DESCRIPTION from the remote source
2. For URL packages, the fetch fails due to bad URL construction; for GitHub packages, it fails without `GITHUB_PAT`
3. The error is caught, and an empty `desc` list is created
4. renv copies **all** fields from the lockfile record into `desc`:
   ```r
   for (field in names(record))
       if (is.null(desc[[field]]))
         desc[[field]] <- record[[field]]  # copies lists as-is
   ```
5. `renv_graph_deps()` calls `renv_description_parse_field(desc[["Imports"]])` with the raw lockfile value

### The type mismatch

renv's JSON parser deserializes lockfile arrays as **R lists**, not character vectors:

```r
lock <- renv:::renv_lockfile_read("renv.lock")
kegg <- lock$Packages$KEGG.db
class(kegg$Imports)   # "list"
is.character(kegg$Imports)  # FALSE
is.list(kegg$Imports)  # TRUE
length(kegg$Imports)   # 2
```

`renv_description_parse_field()` expects a single string like `"methods, AnnotationDbi"` but receives `list("methods", "AnnotationDbi")`. The `is.na()` call on a list of length > 1 produces a logical vector, and `||` requires a scalar.

### Suggested fix

At the top of `renv_description_parse_field()`, collapse multi-element inputs before processing:

```r
renv_description_parse_field <- function(field) {
  if (length(field) > 1L)
    field <- paste(unlist(field), collapse = ", ")
  if (is.null(field) || is.na(field) || !nzchar(field))
    return(NULL)
  # ... rest of function unchanged
}
```

`length(NULL)` is 0 and `length("string")` is 1, so this only fires on multi-element lists/vectors.

---

## Reproducing

### Minimal lockfile (`renv.lock`)

```json
{
  "R": {
    "Version": "4.5.1",
    "Repositories": [
      {
        "Name": "CRAN",
        "URL": "https://cloud.r-project.org"
      }
    ]
  },
  "Packages": {
    "KEGG.db": {
      "Package": "KEGG.db",
      "Version": "2.8.0",
      "Source": "URL",
      "Title": "A set of annotation maps for KEGG",
      "Description": "A set of annotation maps for KEGG assembled using data from KEGG",
      "Author": "Marc Carlson",
      "Maintainer": "Biocore Data Team <biocannotation@lists.fhcrc.org>",
      "Depends": [
        "R (>= 2.7.0)",
        "methods",
        "AnnotationDbi (>= 1.19.35)"
      ],
      "Imports": [
        "methods",
        "AnnotationDbi"
      ],
      "License": "file LICENSE",
      "RemoteType": "url",
      "RemoteUrl": "http://www.bioconductor.org/packages//2.11/data/annotation/src/contrib/KEGG.db_2.8.0.tar.gz",
      "NeedsCompilation": "no"
    }
  }
}
```

### Steps

```r
renv::restore(lockfile = "renv.lock", prompt = FALSE)
```

### Error output

```
Error in is.null(field) || is.na(field) :
  'length = 2' in coercion to 'logical(1)'
Calls: <Anonymous> ... renv_graph_resolve -> renv_graph_deps -> renv_description_parse_field
```

---

## Workaround

Monkey-patch `renv_description_parse_field` before calling `renv::restore()` to collapse multi-element fields:

```r
# Grab the original function
orig <- get("renv_description_parse_field", envir = asNamespace("renv"))

# Wrap it: collapse list/vector fields to a single string, then delegate
patched <- function(field) {
  if (length(field) > 1L)
    field <- paste(unlist(field), collapse = ", ")
  orig(field)
}
environment(patched) <- environment(orig)
utils::assignInNamespace("renv_description_parse_field", patched, ns = "renv")

# Now restore works
renv::restore(lockfile = "renv.lock", prompt = FALSE)
```

Upgrading renv to 1.2.0 does **not** help. Options:
- **Use the monkey-patch above** (recommended) — minimal, preserves original function behavior
- **Install renv from GitHub `main`** — `remotes::install_github("rstudio/renv")` gets a partial fix (URL construction only), but pins to an unreleased version
- **Wait for 1.2.1** — whenever that ships to CRAN

---

## Affected packages in our lockfile

| Package | Source | Trigger |
|---------|--------|---------|
| KEGG.db | URL | Archived Bioconductor, DESCRIPTION fetch fails |
| PGSEA | URL | Archived Bioconductor, DESCRIPTION fetch fails |
| biclust | URL | Archived CRAN, DESCRIPTION fetch fails |
| ggalt | URL | Archived CRAN, DESCRIPTION fetch fails |
| ottoPlots | GitHub | No GITHUB_PAT, DESCRIPTION fetch fails |

---

## Context

This was discovered while building a portable R environment for an Electron app (extracting R + all packages into a self-contained bundle). The lockfile was generated by `renv::snapshot()` with renv 1.1.8 and contains ~350 packages, of which 5 are non-repository sourced (4 URL + 1 GitHub).

**Filed from:** https://github.com/gexijin/idepGolem
