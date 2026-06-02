app_server <- function(input, output, session) {
  # --- Auth gate: hard-deny any session without a valid Electron-issued JWT ---
  # Only enforced when the HMAC secret is present (i.e. launched by the desktop
  # shell). Mirrors idepGolem::verify_shiny_jwt; inlined because this diagnostic
  # package deliberately does not depend on idepGolem.
  secret <- getOption("idep.shiny_hmac_secret", "")
  if (nzchar(secret)) {
    auth_header <- session$request$HTTP_AUTHORIZATION
    jwt <- if (is.null(auth_header)) "" else
      sub("^Bearer\\s+", "", auth_header, ignore.case = TRUE)
    claims <- tryCatch(
      jose::jwt_decode_hmac(jwt, secret = charToRaw(secret)),
      error = function(e) NULL
    )
    # jwt_decode_hmac does NOT reliably enforce exp, so check expiry ourselves.
    exp <- suppressWarnings(as.numeric(claims$exp))
    authed <- !is.null(claims) &&
      length(exp) == 1 && !is.na(exp) && as.numeric(Sys.time()) < exp &&
      identical(claims$iss, "idep-electron") &&
      identical(claims$aud, "idep-shiny")
    if (authed) {
      message("[auth] session authenticated: ", claims$email,
              " (tier=", claims$tier, ")")
    } else {
      message("[auth] DENIED — no valid session JWT; closing connection")
      shiny::showModal(shiny::modalDialog(
        title = "Access denied",
        "This iDEP server only accepts connections from the iDEP desktop app.",
        footer = NULL, easyClose = FALSE
      ))
      session$close()
      return(invisible(NULL))
    }
  }

  # Session-liveness probe: each click is a WebSocket round-trip to R. A fresh
  # server timestamp after a long idle proves the session stayed authenticated.
  output$ping_result <- shiny::renderText({
    if (input$ping == 0) return("Not pinged yet — click the button.")
    paste0("Pong #", input$ping, " at ",
           format(Sys.time(), "%H:%M:%S"), " (server time) — round-trip OK")
  })

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
        "(R launched directly outside Electron, e.g. run_dev.R)."
      )
    }
  })

  output$cwd <- shiny::renderPrint({
    cat(getwd(), "\n")
  })
}
