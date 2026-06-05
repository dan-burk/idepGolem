// Glue layer between the pure-Node auth modules and Electron's main process.
// Keeps main.js's createWindow() readable.

const path = require('path');
const { shell, session, app } = require('electron');
const { runPKCEFlow, refreshIdToken } = require('./auth');
const { verifyEntitlement, entitlementStatus } = require('./entitlement');
const {
  saveEntitlement, loadEntitlement, clearEntitlement,
  saveRefreshToken, loadRefreshToken, clearRefreshToken,
} = require('./cache');
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
// URL of the createPortalSession Cloud Function. Optional — only needed when a
// subscriber opens "Manage Subscription" from the Account menu.
const PORTAL_URL                 = process.env.PORTAL_URL;

// OAuth config is always required — authentication runs in every mode, dev and
// production alike, with no bypass.
if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !ENTITLEMENT_URL) {
  throw new Error(
    'Missing OAuth config. Copy electron/.env.example to electron/.env ' +
    'and fill in your Google OAuth credentials.'
  );
}

/**
 * Use a cached entitlement as an offline-grace fallback when GCP/Google can't
 * be reached to refresh it. Returns a success result if the cached entitlement
 * verified and is still within its grace window (expired < 24h), else null.
 */
function graceResult(cached, claims) {
  if (cached && claims && entitlementStatus(claims) === 'grace') {
    return { ok: true, entitlement: cached, identity: claims, fromCache: true };
  }
  return null;
}

/**
 * Ensure we have a usable entitlement before launching Shiny.
 *
 * Flow:
 *   1. Cached entitlement within `exp`  → use it, no network at all.
 *   2. Otherwise get a fresh Google id-token: silently via the stored refresh
 *      token, or interactively (browser) if there's no refresh token or it was
 *      revoked.
 *   3. Exchange the id-token at /entitlement for a fresh entitlement.
 *   4. If GCP/Google can't be reached and the cached entitlement is still
 *      within its 24h grace window, run on the cache instead of blocking.
 *
 * Returns a discriminated result instead of throwing for known outcomes:
 *   success:        { ok: true,  entitlement, identity, fromCache }
 *   trial ended:    { ok: false, reason: 'pro_required',    message, idToken }
 *   access revoked: { ok: false, reason: 'access_revoked',  message, idToken }
 *   update needed:  { ok: false, reason: 'update_required', message, idToken }
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

  // 1. Load + verify the cached entitlement. Within `exp` → use it directly,
  //    no GCP round-trip. In grace (expired < 24h) → keep it as a fallback but
  //    still try to refresh below. A cache problem (unreadable, corrupt, bad
  //    signature, older than exp+grace) wipes the entitlement ONLY — the
  //    refresh token is kept so we can still recover silently.
  let cached = loadEntitlement();
  let cachedClaims = null;
  if (cached) {
    try {
      cachedClaims = await verifyEntitlement(cached);
      if (entitlementStatus(cachedClaims) === 'valid') {
        onProgress(0.08, `Welcome back, ${cachedClaims.email}`);
        return { ok: true, entitlement: cached, identity: cachedClaims, fromCache: true };
      }
    } catch {
      clearEntitlement();
      cached = null;
      cachedClaims = null;
    }
  }

  // 2. Get a fresh Google id-token. Prefer the stored refresh token (silent, no
  //    browser); fall back to interactive login if there's none or it was
  //    revoked. A network failure here is NOT a revocation — keep the token,
  //    and fall back to the cached entitlement's grace window if one is open,
  //    so an offline user isn't locked out the morning after exp.
  let idToken = null;
  const refreshToken = loadRefreshToken();
  if (refreshToken) {
    onProgress(0.08, 'Refreshing sign-in…');
    try {
      const tokens = await refreshIdToken({
        clientId:     GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken,
      });
      idToken = tokens.id_token;
    } catch (err) {
      // 4xx ⇒ Google rejected the grant (revoked/expired): drop it and re-auth
      // interactively below. Anything else (5xx, or no response = offline) is
      // transient — keep the token, and run on the cached entitlement's grace
      // window if it's still open rather than locking the user out.
      if (err && err.httpStatus >= 400 && err.httpStatus < 500) {
        clearRefreshToken();
      } else {
        const g = graceResult(cached, cachedClaims);
        if (g) { onProgress(0.12, 'Offline — using cached access'); return g; }
        return {
          ok: false,
          reason: 'network_error',
          message: (err && err.message) || 'Could not reach the sign-in server.',
        };
      }
    }
  }

  if (!idToken) {
    // Interactive login: no refresh token, or it was just revoked.
    onProgress(0.08, 'Opening browser to sign in…');
    try {
      const tokens = await runPKCEFlow({
        clientId:      GOOGLE_OAUTH_CLIENT_ID,
        clientSecret:  GOOGLE_OAUTH_CLIENT_SECRET,
        openInBrowser: (url) => shell.openExternal(url),
      });
      idToken = tokens.id_token;
      // Persist the refresh token so future launches refresh silently. Google
      // only returns one on interactive consent, not on the refresh grant.
      if (tokens.refresh_token) {
        try { saveRefreshToken(tokens.refresh_token); } catch { /* non-fatal */ }
      }
    } catch (err) {
      return {
        ok: false,
        reason: 'auth_failed',
        message: (err && err.message) || 'Sign-in was cancelled or failed.',
      };
    }
  }

  // 3. Exchange the id-token for an entitlement. A thrown fetch means GCP was
  //    unreachable — fall back to grace if the cache is still within its
  //    window, otherwise report the outage.
  onProgress(0.12, 'Fetching entitlement…');
  let res;
  try {
    res = await fetch(ENTITLEMENT_URL, {
      method:  'POST',
      headers: {
        'Authorization':      `Bearer ${idToken}`,
        'X-IDEP-App-Version': app.getVersion(),
      },
    });
  } catch (err) {
    // GCP unreachable (DNS, connection refused, timeout) — can't refresh the
    // entitlement now. Run on the cached entitlement's grace window if it's
    // still open; otherwise report the outage.
    const g = graceResult(cached, cachedClaims);
    if (g) { onProgress(0.12, 'Offline — using cached access'); return g; }
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
    if (code === 'pro_required' || code === 'access_revoked' ||
        code === 'update_required') {
      return {
        ok: false,
        reason: code,
        message: userMessage,
        idToken,
      };
    }
    // 5xx: GCP is reachable but erroring (our fault, not the user's). Like the
    // offline/unreachable cases above, fall back to the cached entitlement's
    // grace window if it's still open rather than punishing the user.
    if (res.status >= 500) {
      const g = graceResult(cached, cachedClaims);
      if (g) { onProgress(0.12, 'Service hiccup — using cached access'); return g; }
    }
    // No grace-eligible cache, or a 4xx we don't specifically recognize.
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
    headers: {
      'Authorization':      `Bearer ${idToken}`,
      'X-IDEP-App-Version': app.getVersion(),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Checkout HTTP ${res.status}: ${text}`);
  }
  const { url } = await res.json();
  if (!url) throw new Error('Checkout response contained no URL');
  return url;
}

/**
 * Get a fresh Google id-token silently from the stored refresh token, for
 * authenticated menu actions (Manage Subscription / Upgrade) after launch —
 * the id-token used at startup isn't retained. Returns null if there's no
 * refresh token or the refresh fails (caller should ask the user to re-auth).
 */
async function getFreshIdToken() {
  const refreshToken = loadRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await refreshIdToken({
      clientId:     GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken,
    });
    return tokens.id_token || null;
  } catch {
    return null;
  }
}

/**
 * Start a Stripe Customer Portal session and return its URL. The caller opens
 * that URL in the user's system browser.
 *
 * @param {string} idToken - the Google ID token identifying the user
 * @returns {Promise<string>} the Customer Portal URL
 * @throws {Error} if PORTAL_URL is unset, the call fails, or no URL returns
 */
async function startPortalSession(idToken) {
  if (!PORTAL_URL) {
    throw new Error('PORTAL_URL is not set in electron/.env');
  }
  const res = await fetch(PORTAL_URL, {
    method:  'POST',
    headers: {
      'Authorization':      `Bearer ${idToken}`,
      'X-IDEP-App-Version': app.getVersion(),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Portal HTTP ${res.status}: ${text}`);
  }
  const { url } = await res.json();
  if (!url) throw new Error('Portal response contained no URL');
  return url;
}

module.exports = {
  ensureEntitlement,
  setupShinyRequestAuth,
  startProCheckout,
  startPortalSession,
  getFreshIdToken,
};
