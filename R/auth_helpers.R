#' Verify an Electron-issued Shiny session JWT.
#'
#' The Electron main process signs short-lived JWTs with an HMAC secret it
#' shares with this R process via the SHINY_HMAC_SECRET environment variable
#' (read at bootstrap and stored as the `idep.shiny_hmac_secret` option).
#' Each request from the BrowserWindow carries an `Authorization: Bearer <jwt>`
#' header; this helper verifies it and returns the claims.
#'
#' @param jwt Character. The bearer token from the Authorization header.
#' @param secret Character. The HMAC secret. Defaults to the option set in bootstrap.R.
#' @return A named list of claims (`email`, `tier`, `features`, ...) on success,
#'   or NULL on any failure (missing/invalid/expired/wrong issuer/wrong audience).
#'
#' @details
#' Verification enforces: HS256 signature, issuer = "idep-electron",
#' audience = "idep-shiny", exp not passed.
#'
#' Returns NULL rather than stopping so callers can decide how to handle
#' unauthenticated requests (typically: deny access OR fall back to "free" tier).
verify_shiny_jwt <- function(jwt,
                             secret = getOption("idep.shiny_hmac_secret", "")) {
  if (!nzchar(secret) || !nzchar(jwt)) return(NULL)
  if (!requireNamespace("jose", quietly = TRUE)) {
    warning("jose package not installed; cannot verify Shiny JWT")
    return(NULL)
  }

  tryCatch({
    # jwt_decode_hmac verifies the HS256 signature (and errors on a bad one),
    # but does NOT reliably enforce `exp` — so we check expiry, issuer, and
    # audience ourselves below.
    claims <- jose::jwt_decode_hmac(jwt, secret = charToRaw(secret))

    # Expiry: reject if exp is missing, unparseable, or in the past. exp may
    # come back as numeric epoch seconds or POSIXct; as.numeric handles both.
    exp <- suppressWarnings(as.numeric(claims$exp))
    if (length(exp) != 1 || is.na(exp) || as.numeric(Sys.time()) >= exp) return(NULL)

    if (!identical(claims$iss, "idep-electron")) return(NULL)
    if (!identical(claims$aud, "idep-shiny"))    return(NULL)

    claims
  }, error = function(e) NULL)
}

#' Extract identity from a Shiny session's HTTP request.
#'
#' Call this at session start (e.g., inside the Shiny server function) to
#' populate `session$userData$identity` from the verified JWT.
#'
#' @param session A Shiny session object.
#' @return A claims list (see [verify_shiny_jwt]) or NULL if unauthenticated.
#'
#' @examples
#' \dontrun{
#' # In R/app_server.R, inside the server function:
#' identity <- shiny_identity_from_session(session)
#' session$userData$identity <- identity
#' if (is.null(identity)) {
#'   # No valid auth — show login required UI, OR fall back to free tier
#' } else if (identity$tier == "pro") {
#'   # Unlock pro features
#' }
#' }
shiny_identity_from_session <- function(session) {
  auth_header <- session$request$HTTP_AUTHORIZATION
  if (is.null(auth_header)) return(NULL)
  jwt <- sub("^Bearer\\s+", "", auth_header, ignore.case = TRUE)
  verify_shiny_jwt(jwt)
}
