app_ui <- function(request) {
  # Plain-English notes shown in the field guide beneath the diagnostics.
  # Static text — the values themselves are rendered server-side in
  # app_server.R. Keys mirror the order of the env block above.
  env_help <- list(
    IDEP_DATA_DIR      = "Folder where iDEP reads and writes its database and your results. This is the canonical name; IDEP_DATABASE is kept as a legacy alias for older launch scripts and server setups.",
    IDEP_APP_DIR       = "Location of the bundled Shiny application code that Electron tells R to run.",
    IDEP_HOST          = "Local-only address the Shiny server binds to — always 127.0.0.1, so it is never exposed to the network.",
    IDEP_PORT          = "The port Shiny listens on. Electron picks a free port at each launch and points the desktop window at it.",
    IDEP_DEMO_DIR      = "Folder holding the demo datasets bundled with the app.",
    IDEP_APP           = "Run mode. 'dev' loads this lightweight diagnostic package instead of the full app; the auth flow runs the same either way. Unset in the shipped app.",
    R_LIBS_USER        = "The bundled package library R loads from — the same self-contained folder shown under Library paths.",
    R_HOME             = "Root of the private R installation Electron bundles inside the app.",
    SHINY_HMAC_SECRET  = "Shared secret that signs every request between Electron and Shiny. Set whenever Electron launches R (dev and production alike), so only the app can talk to R; empty only when R is run directly outside Electron."
  )

  # One entry in the bottom field guide: a green label and its explanation.
  guide_item <- function(label, ...) {
    shiny::div(class = "guide-item",
      shiny::span(class = "guide-label", label),
      shiny::span(class = "guide-text", ...)
    )
  }

  env_help_ui <- shiny::tagList(
    lapply(names(env_help), function(name) {
      shiny::div(class = "env-item",
        shiny::tags$code(name),
        shiny::span(class = "env-desc", env_help[[name]])
      )
    })
  )

  shiny::fluidPage(
    shiny::tags$head(
      shiny::tags$style(shiny::HTML("
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
               system-ui, sans-serif; padding: 24px; max-width: 900px;
               margin: 0 auto; }
        h1   { color: #2c7a3f; margin-bottom: 4px; }
        h2   { color: #333; margin-top: 28px; margin-bottom: 8px;
               font-size: 16px; text-transform: uppercase;
               letter-spacing: 0.5px; }
        pre  { background: #f5f5f5; padding: 12px; border-radius: 4px;
               overflow-x: auto; font-size: 13px;
               font-family: 'SF Mono', Consolas, Menlo, monospace; }
        .status-ok   { color: #2c7a3f; font-weight: 600; }
        .status-warn { color: #b8860b; font-weight: 600; }
        .subtitle    { color: #666; margin-bottom: 24px; }
        .guide       { margin-top: 40px; padding-top: 8px;
                       border-top: 2px solid #e3e3e3; }
        .guide-intro { color: #666; margin-bottom: 20px; }
        .guide-item  { margin-bottom: 16px; font-size: 13px; line-height: 1.5; }
        .guide-label { display: block; color: #2c7a3f; font-weight: 600;
                       font-size: 14px; margin-bottom: 2px; }
        .guide-text  { color: #555; }
        .env-item    { margin: 8px 0 8px 16px; font-size: 13px;
                       line-height: 1.45; }
        .env-item code { color: #2c7a3f; font-weight: 600; display: block;
                         font-family: 'SF Mono', Consolas, Menlo, monospace; }
        .env-desc    { color: #555; }
      "))
    ),

    shiny::h1("iDEP Electron Shell ✓"),
    shiny::div(class = "subtitle",
      "Diagnostic app loaded. Electron → R → Shiny handoff is working."
    ),

    # ---- Session liveness probe ----
    # Each click is a server round-trip over the WebSocket. After idling past the
    # 5-min session-JWT TTL, a successful "Pong" confirms the token refreshed and
    # the session stayed authenticated (rather than being dropped to deny).
    shiny::h2("Session liveness"),
    shiny::div(class = "subtitle",
      "Click after waiting 5+ minutes. A fresh server timestamp proves the ",
      "session is still alive and the auth token refreshed."
    ),
    shiny::actionButton("ping", "Ping server"),
    shiny::verbatimTextOutput("ping_result"),

    # ---- Diagnostics (compact readout, as before) ----
    shiny::h2("R runtime"),
    shiny::verbatimTextOutput("r_info"),

    shiny::h2("Library paths"),
    shiny::verbatimTextOutput("libpaths"),

    shiny::h2("Environment (passed in by main.js)"),
    shiny::verbatimTextOutput("env_vars"),

    shiny::h2("HMAC handshake"),
    shiny::uiOutput("hmac_status"),

    shiny::h2("Working directory"),
    shiny::verbatimTextOutput("cwd"),

    # ---- Field guide (plain-English notes) ----
    shiny::div(class = "guide",
      shiny::h2("Field guide — what these mean"),
      shiny::div(class = "guide-intro",
        "Plain-English notes on each section above: what it is and why it ",
        "matters in the shipped desktop app."
      ),

      guide_item("R runtime",
        "The exact R that Electron bundles and launches — its version, install ",
        "location, and platform. In the shipped desktop app this is a private ",
        "copy of R inside the app folder, so users never need R installed."
      ),

      guide_item("Library paths",
        "Where R looks for installed packages. It should list only the app's ",
        "bundled library — a single entry confirms the desktop build is ",
        "self-contained and won't pick up stray packages from the machine."
      ),

      guide_item("Environment (passed in by main.js)",
        "Settings Electron hands to R at launch. In production these wire R to ",
        "the right data folder, port, and security handshake:"
      ),
      env_help_ui,

      guide_item("HMAC handshake",
        "Confirms whether the request-signing secret arrived. In the deployed ",
        "app this must be present — it's how Shiny knows a request truly came ",
        "from the Electron window and not another program on the machine."
      ),

      guide_item("Working directory",
        "The folder R runs from, which is also where iDEP stores its data. It ",
        "must be writable, so the app places it next to the launch location ",
        "(or in your user folder) rather than inside the read-only install dir."
      )
    )
  )
}
