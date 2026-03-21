# Regression tests for issue #831: DEG tab crash on invalid design / full-rank errors
#
# Uses the minimal collinear test dataset (200 genes, 9 samples):
#   testdata/counts_collinear.csv
#   testdata/sample_info_collinear.csv
#
# Sample info has three factor columns:
#   condition       : A | B | C   (3 groups x 3 replicates)
#   batch           : batch1 | batch2 | batch3  (perfectly confounded with condition)
#   condition_batch : A_batch1 | B_batch2 | C_batch3  (pre-combined)
#
# Strategy: call deg_limma() directly. Assert it RETURNS an error string
# rather than THROWING, confirming the tab cannot crash. Also unit-test
# the new internal helpers added in this PR.

# ---------------------------------------------------------------------------
# Load fixtures once
# ---------------------------------------------------------------------------

counts_path <- testthat::test_path("testdata", "counts_collinear.csv")
sinfo_path  <- testthat::test_path("testdata", "sample_info_collinear.csv")

counts_raw  <- as.matrix(read.csv(counts_path, row.names = 1, check.names = FALSE))
# sample_info: CSV is factors-as-rows, samples-as-cols -> transpose to samples-as-rows
sample_info <- as.data.frame(
  t(read.csv(sinfo_path, row.names = 1, check.names = FALSE)),
  stringsAsFactors = FALSE
)

processed   <- log2(counts_raw + 1)   # pre-normalised version for format-2 tests

# ---------------------------------------------------------------------------
# Helper: assert deg_limma returned gracefully (string), never threw
# ---------------------------------------------------------------------------

expect_deg_error <- function(result, tag) {
  expect_true(
    is.character(result),
    info = paste("deg_limma should return a string, not throw. Got:", class(result))
  )
  expect_true(
    grepl(tag, result, fixed = TRUE),
    info = paste0("Expected tag '", tag, "' in:\n  ", result)
  )
}

expect_deg_success <- function(result) {
  expect_true(
    is.list(result),
    info = paste("Expected list result from deg_limma, got:", class(result),
                 if (is.character(result)) result else "")
  )
}

# ===========================================================================
# CRASH SCENARIOS — must return error string, never throw
# ===========================================================================

# 1. Fully confounded 2-factor model (condition + batch collinear)
#    Model matrix is rank-deficient -> FullRankError or EmptyComparisons
test_that("confounded 2-factor model does not crash (limma-trend)", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.05,
    min_fc_limma         = 2,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition: A vs. B", "condition: B vs. C"),
    sample_info          = sample_info,
    model_factors        = c("condition", "batch"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_true(is.character(result))
  expect_true(
    grepl("not full rank", result) | grepl("DEG_ERROR:", result),
    info = paste("Unexpected result:", result)
  )
})

# 2. Same confounded design, limma-voom path (counts_deg_method = 2)
test_that("confounded 2-factor model does not crash (limma-voom)", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.05,
    min_fc_limma         = 2,
    raw_counts           = counts_raw,
    counts_deg_method    = 2,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition: A vs. B"),
    sample_info          = sample_info,
    model_factors        = c("condition", "batch"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_true(is.character(result))
  expect_true(
    grepl("not full rank", result) | grepl("DEG_ERROR:", result),
    info = paste("Unexpected result:", result)
  )
})

# 3. Interaction terms on confounded groups
#    No pair of groups differs by exactly one factor -> EmptyComparisons
test_that("interaction on confounded groups does not crash", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.05,
    min_fc_limma         = 2,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition: A vs. B"),
    sample_info          = sample_info,
    model_factors        = c("condition", "batch", "condition:batch"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_deg_error(result, "DEG_ERROR: EmptyComparisons")
})

# 4. EmptyComparisons: transform_comparisons generates "A_batch1-B_batch1"
#    but B_batch1 does not exist (B only appears with batch2)
test_that("comparisons referencing non-existent group combinations do not crash", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.05,
    min_fc_limma         = 2,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition: A vs. B", "batch: batch1 vs. batch2"),
    sample_info          = sample_info,
    model_factors        = c("condition", "batch"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_deg_error(result, "DEG_ERROR: EmptyComparisons")
})

# ===========================================================================
# VALID SCENARIOS — must return a list result, never error string
# ===========================================================================

# 5. Single factor 'condition': 3 groups x 3 replicates, no confounding
test_that("valid single-factor condition model returns results list", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.99,
    min_fc_limma         = 0,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition: A vs. B"),
    sample_info          = sample_info,
    model_factors        = c("condition"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_deg_success(result)
})

# 6. Pre-combined factor 'condition_batch' as single factor
#    (A_batch1, B_batch2, C_batch3 are 3 distinct groups)
test_that("condition_batch as single combined factor returns results list", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.99,
    min_fc_limma         = 0,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 1,
    selected_comparisons = c("condition_batch: A_batch1 vs. B_batch2"),
    sample_info          = sample_info,
    model_factors        = c("condition_batch"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_deg_success(result)
})

# 7. Condition as main factor, batch as block factor (correct usage)
#    block_factor removes batch from comparisons -> should succeed
test_that("condition main + batch block does not crash", {
  # limma::duplicateCorrelation warns when the block factor is already encoded
  # in the design (expected for this confounded dataset)
  result <- expect_warning(
    deg_limma(
      processed_data       = processed,
      max_p_limma          = 0.99,
      min_fc_limma         = 0,
      raw_counts           = counts_raw,
      counts_deg_method    = 1,
      prior_counts         = 1,
      data_file_format     = 1,
      selected_comparisons = c("condition: A vs. B"),
      sample_info          = sample_info,
      model_factors        = c("condition"),
      block_factor         = "batch",
      reference_levels     = NULL
    ),
    "Block factor already encoded"
  )
  expect_true(is.list(result) | is.character(result))
  if (is.character(result)) {
    expect_true(grepl("DEG_ERROR:", result) | grepl("not full rank", result))
  }
})

# 8. Normalised data format (data_file_format = 2) with valid single factor
test_that("normalised data format with single factor does not crash", {
  result <- deg_limma(
    processed_data       = processed,
    max_p_limma          = 0.99,
    min_fc_limma         = 0,
    raw_counts           = counts_raw,
    counts_deg_method    = 1,
    prior_counts         = 1,
    data_file_format     = 2,
    selected_comparisons = c("condition: A vs. B"),
    sample_info          = sample_info,
    model_factors        = c("condition"),
    block_factor         = NULL,
    reference_levels     = NULL
  )
  expect_deg_success(result)
})

# ===========================================================================
# REACTIVE GUARD — list_interaction_terms_ui (drives valid_interaction_terms)
# ===========================================================================

test_that("list_interaction_terms_ui returns NULL with fewer than 2 factors", {
  expect_null(list_interaction_terms_ui(sample_info, select_factors_model = NULL))
  expect_null(list_interaction_terms_ui(sample_info, select_factors_model = "condition"))
})

test_that("list_interaction_terms_ui returns interaction term with 2 factors", {
  result <- list_interaction_terms_ui(
    sample_info,
    select_factors_model = c("condition", "batch")
  )
  expect_equal(result, "condition:batch")
})

test_that("list_interaction_terms_ui returns all pairs with 3 factors", {
  result <- list_interaction_terms_ui(
    sample_info,
    select_factors_model = c("condition", "batch", "condition_batch")
  )
  expect_length(result, 3)
  expect_true("condition:batch" %in% result)
})

# ===========================================================================
# INTERNAL HELPER UNIT TESTS
# ===========================================================================

test_that(".extract_contrast_tokens splits standard contrast strings", {
  expect_equal(
    idepGolem:::.extract_contrast_tokens("A_batch1-B_batch2"),
    c("A_batch1", "B_batch2")
  )
  expect_equal(
    idepGolem:::.extract_contrast_tokens("GroupA-GroupB-GroupC"),
    c("GroupA", "GroupB", "GroupC")
  )
  expect_length(idepGolem:::.extract_contrast_tokens(""), 0)
})

test_that(".normalize_contrast_case fixes case mismatches", {
  lvls <- c("A_BATCH1", "B_BATCH2", "C_BATCH3")

  expect_equal(
    idepGolem:::.normalize_contrast_case("A_batch1-B_batch2", lvls),
    "A_BATCH1-B_BATCH2"
  )
  expect_equal(
    idepGolem:::.normalize_contrast_case("A_BATCH1-B_BATCH2", lvls),
    "A_BATCH1-B_BATCH2"
  )
  # Unrecognised token left unchanged
  expect_equal(
    idepGolem:::.normalize_contrast_case("X_UNKNOWN-B_BATCH2", lvls),
    "X_UNKNOWN-B_BATCH2"
  )
  expect_length(idepGolem:::.normalize_contrast_case(character(0), lvls), 0)
})

test_that(".report_contrast_mismatch returns NULL when tokens match design", {
  expect_null(
    idepGolem:::.report_contrast_mismatch("A_BATCH1-B_BATCH2", c("A_BATCH1", "B_BATCH2"))
  )
})

test_that(".report_contrast_mismatch returns DEG_ERROR string on mismatch", {
  result <- idepGolem:::.report_contrast_mismatch(
    "A_batch1-B_batch2",
    c("A_BATCH1", "B_BATCH2")
  )
  expect_true(grepl("DEG_ERROR: ContrastMismatch", result))
  expect_true(grepl("A_batch1", result))
})

test_that(".handle_limma_error returns DEG_ERROR: Unexpected string", {
  result <- idepGolem:::.handle_limma_error(simpleError("subscript out of bounds"))
  expect_true(grepl("DEG_ERROR: Unexpected", result))
  expect_true(grepl("subscript out of bounds", result))
})
