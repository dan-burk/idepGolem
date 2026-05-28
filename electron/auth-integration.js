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

const DEV_MODE = process.env.IDEP_APP === 'dev';

if (!DEV_MODE && (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !ENTITLEMENT_URL)) {
  throw new Error(
    'Missing OAuth config. Copy electron/.env.example to electron/.env ' +
    'and fill in your Google OAuth credentials.'
  );
}

/**
 * Ensure we have a usable entitlement before launching Shiny.
 * Tries cache first; if missing/expired, runs PKCE OAuth flow.
 *
 * @param {function(number, string):void} onProgress - splash progress callback
 * @returns {Promise<{entitlement: string, identity: object, fromCache: boolean}>}
 */
async function ensureEntitlement(onProgress) {
  onProgress(0.05, 'Checking sign-in…');

  // 1. Try cache
  const cached = loadEntitlement();
  if (cached) {
    try {
      const claims = await verifyEntitlement(cached);
      const status = entitlementStatus(claims);
      if (status === 'valid' || status === 'grace') {
        onProgress(0.08, `Welcome back, ${claims.email}`);
        return { entitlement: cached, identity: claims, fromCache: true };
      }
      // Expired — fall through to re-auth
      clearEntitlement();
    } catch {
      // Cache corrupt or signature invalid — wipe and re-auth
      clearEntitlement();
    }
  }

  // 2. PKCE flow
  onProgress(0.08, 'Opening browser to sign in…');
  const tokens = await runPKCEFlow({
    clientId:       GOOGLE_OAUTH_CLIENT_ID,
    clientSecret:   GOOGLE_OAUTH_CLIENT_SECRET,
    openInBrowser:  (url) => shell.openExternal(url),
  });

  // 3. Exchange for entitlement
  onProgress(0.12, 'Fetching entitlement…');
  const res = await fetch(ENTITLEMENT_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${tokens.id_token}` },
  });
  if (!res.ok) {
    // Parse the function's JSON error body ({ error, message }) so callers
    // can react to specific codes — e.g. 'pro_required' (trial ended).
    const text = await res.text();
    let code = null;
    let userMessage = null;
    try {
      const parsed = JSON.parse(text);
      code = parsed.error || null;
      userMessage = parsed.message || null;
    } catch { /* body wasn't JSON — leave code/message null */ }
    const err = new Error(`Entitlement HTTP ${res.status}: ${text}`);
    err.code = code;               // e.g. 'pro_required', 'access_revoked'
    err.userMessage = userMessage; // human-readable text from the function
    err.httpStatus = res.status;
    err.idToken = tokens.id_token; // lets the caller start a Pro checkout
    throw err;
  }
  const { entitlement } = await res.json();

  // 4. Verify + cache
  const claims = await verifyEntitlement(entitlement);
  saveEntitlement(entitlement);

  return { entitlement, identity: claims, fromCache: false };
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

  const shinyURLPattern = `http://${host}:${port}/*`;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [shinyURLPattern] },
    (details, callback) => {
      if (currentJWT) {
        details.requestHeaders['Authorization'] = `Bearer ${currentJWT}`;
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  log('[shiny-auth] Authorization header injection active for', shinyURLPattern);
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
