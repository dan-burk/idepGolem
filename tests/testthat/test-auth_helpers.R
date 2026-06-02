# Adversarial tests for the Electron -> Shiny session-JWT verifier.
# verify_shiny_jwt() is the gate that decides whether a Shiny session is allowed.
# These tests prove it ACCEPTS a genuine Electron-issued token and REJECTS every
# forgery an attacker could realistically attempt.

skip_if_not_installed("jose")

SECRET <- "test-hmac-secret-0123456789abcdef"

# Build a token the way electron/hmac.js mintSessionJWT() does: HS256, signed
# with the shared secret, iss=idep-electron, aud=idep-shiny.
make_token <- function(secret = SECRET,
                       iss = "idep-electron",
                       aud = "idep-shiny",
                       exp = as.numeric(Sys.time()) + 300,
                       email = "user@example.com",
                       tier = "pro") {
  claim <- jose::jwt_claim(iss = iss, aud = aud, exp = exp,
                           email = email, tier = tier)
  jose::jwt_encode_hmac(claim, secret = charToRaw(secret))
}

# url-safe base64 without padding, for hand-crafting malicious tokens.
b64url <- function(x) {
  s <- openssl::base64_encode(charToRaw(x))
  gsub("/", "_", gsub("\\+", "-", sub("=+$", "", s)))
}

test_that("a genuine Electron token is accepted and its claims returned", {
  claims <- verify_shiny_jwt(make_token(), secret = SECRET)
  expect_false(is.null(claims))
  expect_identical(claims$email, "user@example.com")
  expect_identical(claims$tier, "pro")
})

test_that("a token signed with the wrong secret is rejected", {
  # The crux: an attacker who does not know our secret cannot forge a valid
  # signature, no matter how correct the claims look.
  forged <- make_token(secret = "attacker-does-not-know-the-secret")
  expect_null(verify_shiny_jwt(forged, secret = SECRET))
})

test_that("a tampered token is rejected", {
  good <- make_token()
  parts <- strsplit(good, ".", fixed = TRUE)[[1]]
  # Flip a character in the payload segment -> signature no longer matches.
  first <- substr(parts[2], 1, 1)
  substr(parts[2], 1, 1) <- if (identical(first, "a")) "b" else "a"
  tampered <- paste(parts, collapse = ".")
  expect_null(verify_shiny_jwt(tampered, secret = SECRET))
})

test_that("an alg:none (unsigned) token is rejected", {
  # Classic JWT bypass: drop the signature and claim alg=none. HMAC verification
  # must refuse it.
  none_tok <- paste0(
    b64url('{"alg":"none","typ":"JWT"}'), ".",
    b64url(paste0('{"iss":"idep-electron","aud":"idep-shiny",',
                  '"email":"x@y.com","tier":"pro","exp":9999999999}')),
    "."
  )
  expect_null(verify_shiny_jwt(none_tok, secret = SECRET))
})

test_that("an expired token is rejected", {
  expired <- make_token(exp = as.numeric(Sys.time()) - 10)
  expect_null(verify_shiny_jwt(expired, secret = SECRET))
})

test_that("wrong issuer or audience is rejected", {
  expect_null(verify_shiny_jwt(make_token(iss = "evil"), secret = SECRET))
  expect_null(verify_shiny_jwt(make_token(aud = "evil"), secret = SECRET))
})

test_that("missing, empty, or garbage input is rejected", {
  expect_null(verify_shiny_jwt("", secret = SECRET))
  expect_null(verify_shiny_jwt("not.a.jwt", secret = SECRET))
  expect_null(verify_shiny_jwt(make_token(), secret = ""))   # no secret configured
})
