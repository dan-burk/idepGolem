app_ui <- function(request) {
  # Plain-English notes shown to the right of each diagnostic block. Static
  # text — the values themselves are rendered server-side in app_server.R.
  env_help <- list(
    IDEP_DATA_DIR      = "Folder where iDEP reads and writes its database and your results. This is the canonical name; IDEP_DATABASE is kept as a legacy alias for older launch scripts and server setups.",
    IDEP_APP_DIR       = "Location of the bundled Shiny application code that Electron tells R to run.",
    IDEP_HOST          = "Local-only address the Shiny server binds to — always 127.0.0.1, so it is never exposed to the network.",
    IDEP_PORT          = "The port Shiny listens on. Electron picks a free port at each launch and points the desktop window at it.",
    IDEP_DEMO_DIR      = "Folder holding the demo datasets bundled with the app.",
    IDEP_AUTH_DISABLED = "Legacy switch that used to bypass sign-in; replaced by IDEP_APP=dev. 'NA' simply means it is not set.",
    IDEP_APP           = "Run mode. 'dev' skips sign-in for local iteration; in the shipped app it is unset, so the full auth flow runs.",
    R_LIBS_USER        = "The bundled package library R loads from — the same self-contained folder shown under Library paths.",
    R_HOME             = "Root of the private R installation Electron bundles inside the app.",
    SHINY_HMAC_SECRET  = "Shared secret that signs every request between Electron and Shiny. Empty in dev; set in production so only the app can talk to R."
  )

  env_help_ui <- shiny::tagList(
    lapply(names(env_help), function(name) {
      shiny::div(class = "env-item",
        shiny::tags$code(name),
        shiny::span(class = "env-desc", env_help[[name]])
      )
    })
  )

  # One diagnostic section: full-width heading, then raw output (left) paired
  # with a plain-English note (right).
  section <- function(title, output_ui, explanation) {
    shiny::div(class = "diag-section",
      shiny::h2(title),
      shiny::fluidRow(
        shiny::column(7, output_ui),
        shiny::column(5, shiny::div(class = "explain", explanation))
      )
    )
  }

  shiny::fluidPage(
    shiny::tags$head(
      shiny::tags$style(shiny::HTML("
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
               system-ui, sans-serif; padding: 24px; max-width: 1150px;
               margin: 0 auto; }
        h1   { color: #2c7a3f; margin-bottom: 4px; }
        h2   { color: #333; margin-top: 28px; margin-bottom: 12px;
               font-size: 16px; text-transform: uppercase;
               letter-spacing: 0.5px; }
        pre  { background: #f5f5f5; padding: 12px; border-radius: 4px;
               overflow-x: auto; font-size: 13px;
               font-family: 'SF Mono', Consolas, Menlo, monospace; }
        .status-ok   { color: #2c7a3f; font-weight: 600; }
        .status-warn { color: #b8860b; font-weight: 600; }
        .subtitle    { color: #666; margin-bottom: 8px; }
        .layout-note { color: #888; font-size: 13px; margin-bottom: 24px;
                       font-style: italic; }
        .diag-section { margin-bottom: 8px; }
        .explain { color: #555; font-size: 13px; line-height: 1.5;
                   border-left: 3px solid #cfe3d5; padding-left: 14px; }
        .env-item { margin-bottom: 10px; font-size: 13px; line-height: 1.45; }
        .env-item code { color: #2c7a3f; font-weight: 600; display: block;
                         font-family: 'SF Mono', Consolas, Menlo, monospace; }
        .env-desc { color: #555; }
      "))
    ),

    shiny::h1("iDEP Electron Shell ✓"),
    shiny::div(class = "subtitle",
      "Diagnostic app loaded. Electron → R → Shiny handoff is working."
    ),
    shiny::div(class = "layout-note",
      "Each panel pairs the raw diagnostic (left) with a plain-English note ",
      "on what it is and why it matters in the shipped desktop app (right)."
    ),

    section("R runtime",
      shiny::verbatimTextOutput("r_info"),
      paste(
        "The exact R that Electron bundles and launches — its version, install",
        "location, and platform. In the shipped desktop app this is a private",
        "copy of R inside the app folder, so users never need R installed."
      )
    ),

    section("Library paths",
      shiny::verbatimTextOutput("libpaths"),
      paste(
        "Where R looks for installed packages. It should list only the app's",
        "bundled library — a single entry confirms the desktop build is",
        "self-contained and won't pick up stray packages from the machine."
      )
    ),

    section("Environment (passed in by main.js)",
      shiny::verbatimTextOutput("env_vars"),
      shiny::tagList(
        shiny::p(style = "margin-top: 0;",
          "Settings Electron hands to R at launch. In production these wire R",
          "to the right data folder, port, and security handshake:"
        ),
        env_help_ui
      )
    ),

    section("HMAC handshake",
      shiny::uiOutput("hmac_status"),
      paste(
        "Confirms whether the request-signing secret arrived. In the deployed",
        "app this must be present — it's how Shiny knows a request truly came",
        "from the Electron window and not another program on the machine."
      )
    ),

    section("Working directory",
      shiny::verbatimTextOutput("cwd"),
      paste(
        "The folder R runs from, which is also where iDEP stores its data. It",
        "must be writable, so the app places it next to the launch location",
        "(or in your user folder) rather than inside the read-only install dir."
      )
    )
  )
}
