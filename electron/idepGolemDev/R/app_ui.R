app_ui <- function(request) {
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
      "))
    ),

    shiny::h1("iDEP Electron Shell ✓"),
    shiny::div(class = "subtitle",
      "Diagnostic app loaded. Electron → R → Shiny handoff is working."
    ),

    shiny::h2("R runtime"),
    shiny::verbatimTextOutput("r_info"),

    shiny::h2("Library paths"),
    shiny::verbatimTextOutput("libpaths"),

    shiny::h2("Environment (passed in by main.js)"),
    shiny::verbatimTextOutput("env_vars"),

    shiny::h2("HMAC handshake"),
    shiny::uiOutput("hmac_status"),

    shiny::h2("Working directory"),
    shiny::verbatimTextOutput("cwd")
  )
}
