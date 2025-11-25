
#' 14_survey UI Function
#'
#' @description A shiny Module.
#' @param id,input,output,session Internal parameters for {shiny}.
#' @noRd
#' @importFrom shiny NS tagList
mod_14_survey_ui <- function(id) {
  ns <- NS(id)
  tagList(

    # Allow full-width layout inside modal
    tags$style(HTML("
      .modal-body .form-group,
      .modal-body .shiny-input-container {
        width: 100% !important;
      }
    ")),

    # LocalStorage + Shiny bridge
    tags$head(
      tags$script(src = "www/survey_storage.js"),
        tags$script(HTML(paste0(
          "var surveyNamespace = '", ns(""), "';",
          "var surveyInputId = '", ns("survey_done_storage"), "';"
    ))))
  )
}

#' 14_survey Server Functions
#' @noRd
mod_14_survey_server <- function(id) {
  moduleServer(id, function(input, output, session) {
    ns <- session$ns

    # Show modal once
    observe({
      if (!is.null(input$survey_done_storage)) {
        # Show modal only if survey is NOT done (FALSE)
        if (!isTRUE(input$survey_done_storage)) {

          showModal(modalDialog(
            title = "We'd love your feedback!",
            size = "l",
            easyClose = FALSE,
            footer = tagList(
              actionButton(ns("close_survey"), "Done", class = "btn-primary"),
              actionButton(ns("decline_survey"), "Skip", class = "btn-secondary")
            ),

            # Privacy notice (top)
            tags$div(
              style = "background:#f8f9fa;border:1px solid #e3e6ea;border-radius:6px;
                      padding:12px;margin-bottom:12px;font-size:1.00em;",
              tags$p("Thank you for using iDEP! Please complete our quick survey (~30 seconds)."),
              tags$p(
                tags$b("Note: "), "Click ",
                tags$span("'Done'", style="color:#0066cc;font-weight:bold;"),
                " after submitting or ",
                tags$span("'Skip'", style="color:#666;font-weight:bold;"),
                " to opt-out."
              )
            ),

            # Embedded Google Form
            tags$iframe(
              src="https://docs.google.com/forms/d/e/1FAIpQLSdSHzwCkwDrxwrlARWC6zM72ci1F5UV91Ir3L-VplkgH6ZWrg/viewform?embedded=true",
              width = "100%",
              height = "600px",
              frameborder = "0",
              marginheight = "0",
              marginwidth = "0",
              style = "border:none;"
            )
          ))
        }
      }
    })

    # Done button - user filled out form or wants to close
    observeEvent(input$close_survey, {
      removeModal()
      session$sendCustomMessage("markSurveyComplete", list())
    })

    # Skip button - user doesn't want to participate
    observeEvent(input$decline_survey, {
      removeModal()
      session$sendCustomMessage("markSurveyComplete", list())
    })
  })
}


## To be copied in the UI
# mod_14_survey_ui("14_survey_1")

## To be copied in the server
# mod_14_survey_server("14_survey_1")