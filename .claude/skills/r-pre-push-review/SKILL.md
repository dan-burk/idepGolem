---
name: r-pre-push-review
description: >
  Reviews all staged/unstaged R code changes in a GitHub repo before the user pushes to a branch.
  Use this skill whenever the user wants to review their code changes before pushing, asks if their
  code is "ready to push", wants a pre-push check, or says things like "review my changes",
  "check my code before I push", "is my R code good to go", or "pre-push review". Works both
  automatically (via git diff in bash) and manually (user pastes a diff). Focuses on bugs & logic
  errors, security vulnerabilities, performance issues, and test coverage in R code.
---

# R Pre-Push Code Review

A skill for reviewing R code changes before pushing to a GitHub branch. Covers bugs, security,
performance, and test coverage. Works with `git diff` (auto mode) or a pasted diff (manual mode).

---

## Step 1: Get the Diff

### Auto Mode (preferred when running in a repo)
Run the following bash commands to capture all local changes:

```bash
# Staged changes (ready to commit)
git diff --cached

# Unstaged changes (modified but not yet staged)
git diff

# List of changed files
git diff --name-only
git diff --cached --name-only
```

If both return empty, remind the user that there may be no local changes relative to the current branch HEAD. In that case, ask if they want to compare against a specific branch:

```bash
git diff main...HEAD   # or replace 'main' with their base branch
```

### Manual Mode
If the user pastes a diff directly (or running bash isn't possible), skip Step 1 and proceed to Step 2 using the pasted content.

---

## Step 2: Identify Changed R Files

Focus your review on files ending in `.R` or `.Rmd`. You may briefly note issues in other file types (e.g., `DESCRIPTION`, `.yaml`, `Makefile`) but do not deep-review them.

If there are no R file changes, tell the user: *"No R file changes detected in this diff. Let me know if you'd like me to review a different file type."*

---

## Step 3: Run the Review

Analyze the diff carefully across the four priority areas below. For each issue found, note:
- **File & approximate line number** (from the diff context)
- **Severity**: 🔴 Critical / 🟡 Warning / 🔵 Suggestion
- **What the problem is**
- **What to do instead** (with a corrected code snippet if helpful)

---

### Priority 1 — Bugs & Logic Errors 🔴

Look for:
- **Off-by-one errors** in loops, indexing (`seq_len()` vs `1:n` when `n=0`)
- **Vectorisation assumptions** broken (applying scalar logic to vectors without `vapply`/`sapply`)
- **Silent type coercion** (e.g., comparing numeric to character, factor drop levels)
- **NA handling** — missing `na.rm = TRUE`, not checking `is.na()` before operations
- **Incorrect use of `=` vs `==`** in conditionals
- **`T`/`F` shorthand** instead of `TRUE`/`FALSE` (fragile — can be overwritten)
- **`which()` returning `integer(0)`** used without length check
- **Recycling rules** misused (e.g., adding vectors of incompatible lengths silently)
- **`<<-` operator** used unexpectedly (modifies parent env, common source of bugs)
- **`paste()` vs `paste0()`** confusion introducing unwanted spaces
- **`library()` inside functions** (should be at top-level or use `requireNamespace()`)

---

### Priority 2 — Security Vulnerabilities 🔴

Look for:
- **Hardcoded credentials** — API keys, passwords, tokens in plain text
- **`system()` / `system2()` calls** with user-controlled input (command injection risk)
- **`eval(parse(text = ...))` with external input** (code injection)
- **Unvalidated file paths** passed to `readLines()`, `source()`, `read.csv()`, etc.
- **Secrets in `.Renviron` committed to repo** — flag if `.Renviron` appears in diff
- **`Sys.setenv()` exposing secrets** in logs or output
- **SQL injection** via `DBI::dbGetQuery()` with string-concatenated queries (should use parameterised queries)
- **Writing files outside the project directory** without validation

---

### Priority 3 — Performance Issues 🟡

Look for:
- **Growing objects in loops** (`result <- c(result, x)` inside a loop — use pre-allocation or `vector()`)
- **`rbind()` / `cbind()` in loops** — extremely slow for large data; suggest `do.call(rbind, list)`
- **`apply` family misuse** when a vectorised base function would work
- **Loading large datasets repeatedly** instead of caching
- **Unneeded `library()` calls** loading heavy packages for minor uses (suggest `pkg::fn()` instead)
- **`for` loops over data.frame rows** — often replaceable with `dplyr::rowwise()` or vectorised ops
- **`Sys.sleep()` in production code** without justification
- **Reading/writing in a tight loop** — batch I/O where possible
- **Missing `stringsAsFactors = FALSE`** in legacy code (pre-R 4.0)

---

### Priority 4 — Test Coverage 🟡

Look for:
- **New functions with no corresponding test** in `tests/testthat/` (or similar)
- **Edge cases not tested**: `NA` inputs, zero-length vectors, empty data frames, negative numbers
- **Tests that never assert anything** — `test_that()` blocks with no `expect_*()` calls
- **Changed function signatures not reflected** in existing tests
- **`testthat` not used** when a `tests/` directory exists (suggest adding it)
- **Brittle snapshot tests** that may fail across R versions
- If no `tests/` directory exists at all, flag it as a 🔵 Suggestion to add one

---

## Step 4: Deliver the Verdict

End your review with a clear, structured summary:

---

### ✅ READY TO PUSH  
*or*  
### 🚫 NEEDS WORK BEFORE PUSHING

---

Then provide:

**Summary table** (if there are issues):

| Severity | File | Issue | Fix |
|----------|------|-------|-----|
| 🔴 Critical | `R/model.R:42` | Hardcoded API key | Move to `Sys.getenv()` |
| 🟡 Warning | `R/utils.R:17` | Growing vector in loop | Pre-allocate with `vector()` |
| 🔵 Suggestion | — | No tests for `new_function()` | Add `testthat` coverage |

**If READY TO PUSH**: Briefly call out what was done well, and note any minor suggestions as optional.

**If NEEDS WORK**: List only the 🔴 Critical and 🟡 Warning items as blockers. Group 🔵 Suggestions separately as "Optional improvements."

---

## Tone & Format Notes

- Be direct and specific — no vague feedback like "this could be improved"
- Always show the corrected code snippet for Critical issues
- Keep suggestions actionable; link to relevant R docs only if very helpful
- If the diff is large (>500 lines), focus on the highest-risk areas and note you've prioritised them
- Don't repeat issues already present in the base branch (only review what changed)
