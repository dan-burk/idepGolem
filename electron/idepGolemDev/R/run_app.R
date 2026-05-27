#' Run the diagnostic Shiny application
#'
#' Drop-in replacement for `idepGolem::run_app()` used to exercise the
#' Electron shell without loading the full iDEP runtime. Returns a
#' `shiny.appobj` that `bootstrap.R` can hand to `shiny::runApp()`.
#'
#' @param onStart,options,enableBookmarking,uiPattern Passed through to
#'   `shiny::shinyApp()` — same signature as `idepGolem::run_app()`.
#' @param ... Additional golem options.
#'
#' @export
run_app <- function(onStart = NULL,
                    options = list(),
                    enableBookmarking = NULL,
                    uiPattern = "/",
                    ...) {
  golem::with_golem_options(
    app = shiny::shinyApp(
      ui = app_ui,
      server = app_server,
      onStart = onStart,
      options = options,
      enableBookmarking = enableBookmarking,
      uiPattern = uiPattern
    ),
    golem_opts = list(...)
  )
}
