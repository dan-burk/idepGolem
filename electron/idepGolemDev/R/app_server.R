app_server <- function(input, output, session) {
  output$r_info <- shiny::renderPrint({
    cat("Version:   ", R.version.string, "\n")
    cat("R.home():  ", R.home(), "\n")
    cat("Platform:  ", R.version$platform, "\n")
    cat("OS:        ", R.version$os, "\n")
  })

  output$libpaths <- shiny::renderPrint({
    cat(paste(.libPaths(), collapse = "\n"), "\n")
  })

  output$env_vars <- shiny::renderPrint({
    vars <- c(
      "IDEP_DATA_DIR", "IDEP_APP_DIR", "IDEP_HOST", "IDEP_PORT",
      "IDEP_DEMO_DIR", "IDEP_APP",
      "R_LIBS_USER", "R_HOME", "SHINY_HMAC_SECRET"
    )
    for (v in vars) {
      val <- Sys.getenv(v, unset = NA)
      if (identical(v, "SHINY_HMAC_SECRET") && !is.na(val) && nzchar(val)) {
        val <- paste0("(", nchar(val), " chars, redacted)")
      }
      cat(sprintf("%-22s = %s\n", v, val))
    }
  })

  output$hmac_status <- shiny::renderUI({
    secret <- getOption("idep.shiny_hmac_secret", "")
    if (nzchar(secret)) {
      shiny::span(class = "status-ok",
        "✓ HMAC secret present — auth handshake is enabled."
      )
    } else {
      shiny::span(class = "status-warn",
        "⚠ No HMAC secret — running unauthenticated ",
        "(dev mode via IDEP_APP=dev, or launched outside Electron)."
      )
    }
  })

  output$cwd <- shiny::renderPrint({
    cat(getwd(), "\n")
  })
}
