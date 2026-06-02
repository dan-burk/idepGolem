# Standalone adversarial check for verify_shiny_jwt() — no devtools/testthat.
# Needs only the `jose` package. Run from the repo root:
#   Rscript dev/auth_check.R
# or in an R console:  source("dev/auth_check.R")
# Throwaway dev utility — delete once auth is settled.

stopifnot(requireNamespace("jose", quietly = TRUE))
source("R/auth_helpers.R")

SECRET <- "test-hmac-secret-0123456789abcdef"

# Build a token the way electron/hmac.js mintSessionJWT() does.
make_token <- function(secret = SECRET, iss = "idep-electron", aud = "idep-shiny",
                       exp = as.numeric(Sys.time()) + 300,
                       email = "user@example.com", tier = "pro") {
  claim <- jose::jwt_claim(iss = iss, aud = aud, exp = exp, email = email, tier = tier)
  jose::jwt_encode_hmac(claim, secret = charToRaw(secret))
}

# url-safe base64 (no padding) for hand-crafting malicious tokens.
b64url <- function(x) {
  s <- openssl::base64_encode(charToRaw(x))
  gsub("/", "_", gsub("\\+", "-", sub("=+$", "", s)))
}

check <- function(label, ok) {
  cat(sprintf("[%s] %s\n", if (isTRUE(ok)) "PASS" else "FAIL", label))
  isTRUE(ok)
}

results <- c(
  check("genuine token accepted",
        { c <- verify_shiny_jwt(make_token(), secret = SECRET)
          !is.null(c) && identical(c$tier, "pro") }),

  check("wrong-secret forgery rejected",
        is.null(verify_shiny_jwt(make_token(secret = "attacker-guess"), secret = SECRET))),

  check("tampered token rejected",
        { p <- strsplit(make_token(), ".", fixed = TRUE)[[1]]
          f <- substr(p[2], 1, 1); substr(p[2], 1, 1) <- if (identical(f, "a")) "b" else "a"
          is.null(verify_shiny_jwt(paste(p, collapse = "."), secret = SECRET)) }),

  check("alg:none (unsigned) token rejected",
        { tok <- paste0(b64url('{"alg":"none","typ":"JWT"}'), ".",
                        b64url(paste0('{"iss":"idep-electron","aud":"idep-shiny",',
                                      '"email":"x@y.com","tier":"pro","exp":9999999999}')), ".")
          is.null(verify_shiny_jwt(tok, secret = SECRET)) }),

  check("expired token rejected",
        is.null(verify_shiny_jwt(make_token(exp = as.numeric(Sys.time()) - 10), secret = SECRET))),

  check("wrong issuer rejected",
        is.null(verify_shiny_jwt(make_token(iss = "evil"), secret = SECRET))),

  check("wrong audience rejected",
        is.null(verify_shiny_jwt(make_token(aud = "evil"), secret = SECRET))),

  check("empty jwt rejected",   is.null(verify_shiny_jwt("", secret = SECRET))),
  check("garbage jwt rejected", is.null(verify_shiny_jwt("not.a.jwt", secret = SECRET))),
  check("no secret configured rejected", is.null(verify_shiny_jwt(make_token(), secret = "")))
)

cat(sprintf("\n%d/%d passed\n", sum(results), length(results)))
# Only signal a nonzero exit in batch (Rscript) mode — never kill an
# interactive session that source()'d this file.
if (!all(results) && !interactive()) quit(status = 1)
