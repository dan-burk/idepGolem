// Glue layer between the pure-Node auth modules and Electron's main process.
// Keeps main.js's createWindow() readable.

const path = require('path');
const { shell, session } = require('electron');
const { runPKCEFlow } = require('./auth');
const { verifyEntitlement, entitlementStatus } = require('./entitlement');
const { saveEntitlement, loadEntitlement, clearEntitlement } = require('./cache');
const { mintSessionJWT, SESSION_JWT_TTL_SEC } = require('./hmac');

// OAuth credentials live in a gitignored .env file. Per RFC 8252 §8.5
// the desktop client secret is "not confidential" — but keeping it out
// of source still avoids secret-scanner false positives and simplifies
// rotation. See .env.example for the file shape and setup steps.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const GOOGLE_OAUTH_CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const ENTITLEMENT_URL            = process.env.ENTITLEMENT_URL;
// URL of the createCheckoutSession Cloud Function. Optional — only needed
// when a blocked user clicks "Upgrade to Pro", so it is deliberately NOT in
// the required-config check below.
const CHECKOUT_URL               = process.env.CHECKOUT_URL;

// OAuth config is always required — authentication runs in every mode, dev and
// production alike, with no bypass.
if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !ENTITLEMENT_URL) {
  throw new Error(
    'Missing OAuth config. Copy electron/.env.example to electron/.env ' +
    'and fill in your Google OAuth credentials.'
  );
}

/**
 * Ensure we have a usable entitlement before launching Shiny.
 * Tries cache first; if missing/expired, runs PKCE OAuth flow.
 *
 * Returns a discriminated result instead of throwing for known outcomes:
 *   success:        { ok: true,  entitlement, identity, fromCache }
 *   trial ended:    { ok: false, reason: 'pro_required',   message, idToken }
 *   access revoked: { ok: false, reason: 'access_revoked', message, idToken }
 *   OAuth aborted:  { ok: false, reason: 'auth_failed',    message }
 *   server down:    { ok: false, reason: 'network_error',  message }
 *   other HTTP/5xx: { ok: false, reason: 'server_error',   message, httpStatus }
 *
 * Only programmer-error conditions (e.g. the missing-OAuth-config check above)
 * throw; every response from the world is returned as one of the shapes above.
 *
 * @param {function(number, string):void} onProgress - splash progress callback
 * @returns {Promise<object>} discriminated result (see shapes above)
 */
async function ensureEntitlement(onProgress) {
  onProgress(0.05, 'Checking sign-in…');

  // 1. Try cache. Any cache problem — unreadable file, corrupt data, bad
  //    signature, or expired — is non-fatal: wipe and fall through to re-auth.
  try {
    const cached = loadEntitlement();
    if (cached) {
      const claims = await verifyEntitlement(cached);
      const status = entitlementStatus(claims);
      if (status === 'valid' || status === 'grace') {
        onProgress(0.08, `Welcome back, ${claims.email}`);
        return { ok: true, entitlement: cached, identity: claims, fromCache: true };
      }
      // Expired — fall through to re-auth
      clearEntitlement();
    }
  } catch {
    // Cache unreadable / corrupt / signature invalid — wipe and re-auth.
    clearEntitlement();
  }

  // 2. PKCE flow. A rejection here means the OAuth/PKCE flow was aborted or
  //    errored (user closed the browser, redirect failed, etc.) — a known
  //    failure, returned rather than thrown.
  onProgress(0.08, 'Opening browser to sign in…');
  let tokens;
  try {
    tokens = await runPKCEFlow({
      clientId:       GOOGLE_OAUTH_CLIENT_ID,
      clientSecret:   GOOGLE_OAUTH_CLIENT_SECRET,
      openInBrowser:  (url) => shell.openExternal(url),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'auth_failed',
      message: (err && err.message) || 'Sign-in was cancelled or failed.',
    };
  }

  // 3. Exchange for entitlement. A thrown fetch means the endpoint was
  //    unreachable (DNS, connection refused, timeout) — a network error,
  //    distinct from the HTTP error responses handled just below.
  onProgress(0.12, 'Fetching entitlement…');
  let res;
  try {
    res = await fetch(ENTITLEMENT_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${tokens.id_token}` },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network_error',
      message: (err && err.message) || 'Could not reach the entitlement server.',
    };
  }

  if (!res.ok) {
    // Parse the function's JSON error body ({ error, message }) so we can map
    // specific codes to discriminated reasons.
    const text = await res.text();
    let code = null;
    let userMessage = null;
    try {
      const parsed = JSON.parse(text);
      code = parsed.error || null;
      userMessage = parsed.message || null;
    } catch { /* body wasn't JSON — leave code/message null */ }

    // Recognized business outcomes: the user authenticated successfully but is
    // not entitled. Carry the id token so the caller can start a Pro checkout.
    if (code === 'pro_required' || code === 'access_revoked') {
      return {
        ok: false,
        reason: code,
        message: userMessage,
        idToken: tokens.id_token,
      };
    }
    // Anything else (5xx, or an unrecognized code) is a server-side error.
    return {
      ok: false,
      reason: 'server_error',
      message: userMessage || `Entitlement HTTP ${res.status}: ${text}`,
      httpStatus: res.status,
    };
  }

  // 4. Verify the freshly fetched entitlement. A malformed or unverifiable
  //    payload here is a response from the world (a bad body from the Cloud
  //    Function), so it is surfaced as a server_error rather than thrown.
  let entitlement;
  let claims;
  try {
    ({ entitlement } = await res.json());
    claims = await verifyEntitlement(entitlement);
  } catch (err) {
    return {
      ok: false,
      reason: 'server_error',
      message: (err && err.message) || 'Received an invalid entitlement response.',
      httpStatus: res.status,
    };
  }

  // Persisting to the local cache is best-effort: a disk-write failure must not
  // block a user who just verified — they simply re-auth on the next launch.
  try { saveEntitlement(entitlement); } catch { /* non-fatal */ }

  return { ok: true, entitlement, identity: claims, fromCache: false };
}

/**
 * Set up the per-request Authorization header injection for the Shiny URL.
 * The header is a short-lived HMAC-signed JWT. We refresh it well before
 * expiry so long-running sessions never see a 401.
 */
function setupShinyRequestAuth({ host, port, hmacSecret, identity, log }) {
  let currentJWT = null;
  let refreshTimer = null;

  async function refresh() {
    try {
      currentJWT = await mintSessionJWT(hmacSecret, identity);
    } catch (err) {
      log('[shiny-auth] mint failed', err && err.message);
    }
  }

  // Refresh at 80% of TTL — gives a safety margin even under clock skew.
  const refreshIntervalMs = Math.floor(SESSION_JWT_TTL_SEC * 1000 * 0.8);

  refresh().then(() => {
    refreshTimer = setInterval(refresh, refreshIntervalMs);
    refreshTimer.unref();
  });

  // Shiny serves the initial HTML over http:// but runs the live session over a
  // WebSocket (ws://). session$request in R is the ws handshake request, so the
  // header MUST be injected on ws:// too — http:// alone leaves R unauthenticated.
  const shinyURLPatterns = [
    `http://${host}:${port}/*`,
    `ws://${host}:${port}/*`,
  ];
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: shinyURLPatterns },
    (details, callback) => {
      if (currentJWT) {
        details.requestHeaders['Authorization'] = `Bearer ${currentJWT}`;
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  log('[shiny-auth] Authorization header injection active for', shinyURLPatterns.join(' '));
}

/**
 * Start a Stripe Checkout session for iDEP Pro and return its URL.
 * The caller opens that URL in the user's system browser.
 *
 * @param {string} idToken - the Google ID token identifying the user
 * @returns {Promise<string>} the Stripe Checkout URL
 * @throws {Error} if CHECKOUT_URL is unset, the call fails, or no URL returns
 */
async function startProCheckout(idToken) {
  if (!CHECKOUT_URL) {
    throw new Error('CHECKOUT_URL is not set in electron/.env');
  }
  const res = await fetch(CHECKOUT_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Checkout HTTP ${res.status}: ${text}`);
  }
  const { url } = await res.json();
  if (!url) throw new Error('Checkout response contained no URL');
  return url;
}

module.exports = { ensureEntitlement, setupShinyRequestAuth, startProCheckout };
