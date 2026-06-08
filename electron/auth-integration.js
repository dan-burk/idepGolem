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
 * Pull the email claim out of a Google id-token WITHOUT verifying its
 * signature. Safe here because the token came straight from Google's token
 * endpoint over TLS, and we use the email only to confirm the user
 * re-authenticated as the SAME account — never to grant access.
 */
function emailFromIdToken(idToken) {
  try {
    const payload = String(idToken).split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).email || null;
  } catch {
    return null;
  }
}

/**
 * Obtain a fresh Google id-token for an authenticated menu action (Manage
 * Subscription), for the SAME account that is signed in. Tries the silent
 * refresh-token grant first; if there's no refresh token or it was revoked,
 * falls back to an interactive login PINNED to `currentEmail` (login_hint +
 * no account chooser). A transient/offline failure does NOT open the browser.
 *
 * Mid-session account switching is not allowed — the only way to switch is
 * Sign Out → Sign In. Google won't hard-restrict the account at its own
 * screen, so we enforce it: a login as a different account is refused.
 *
 * @param {string} currentEmail - the signed-in account (global.identity.email)
 * @returns {Promise<object>} one of:
 *   { ok: true,  idToken }
 *   { ok: false, reason: 'network_error',    message }   // offline / 5xx — no browser shown
 *   { ok: false, reason: 'auth_failed',      message }   // browser cancelled / failed
 *   { ok: false, reason: 'account_mismatch', email }     // signed in as someone else
 */
async function getActionIdToken(currentEmail) {
  // 1. Silent: stored refresh token → fresh id-token, no browser.
  const refreshToken = loadRefreshToken();
  if (refreshToken) {
    try {
      const tokens = await refreshIdToken({
        clientId:     GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken,
      });
      if (tokens.id_token) return { ok: true, idToken: tokens.id_token };
    } catch (err) {
      // 4xx ⇒ revoked/expired: drop it and re-auth interactively below.
      // Anything else (5xx, or no response = offline) is transient — report it
      // rather than popping a browser the user didn't ask for.
      if (err && err.httpStatus >= 400 && err.httpStatus < 500) {
        clearRefreshToken();
      } else {
        return {
          ok: false,
          reason: 'network_error',
          message: (err && err.message) || 'Could not reach the sign-in server.',
        };
      }
    }
  }

  // 2. Interactive, pinned to the current account: login_hint + no chooser.
  let tokens;
  try {
    tokens = await runPKCEFlow({
      clientId:      GOOGLE_OAUTH_CLIENT_ID,
      clientSecret:  GOOGLE_OAUTH_CLIENT_SECRET,
      openInBrowser: (url) => shell.openExternal(url),
      loginHint:     currentEmail,
      prompt:        'consent', // no select_account: re-auth THIS account
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'auth_failed',
      message: (err && err.message) || 'Sign-in was cancelled or failed.',
    };
  }

  // 3. Hard guard: Google won't guarantee the account, so we do. A different
  //    account is refused — switching is only via Sign Out → Sign In.
  const email = emailFromIdToken(tokens.id_token);
  if (!email || email.toLowerCase() !== String(currentEmail).toLowerCase()) {
    return { ok: false, reason: 'account_mismatch', email };
  }

  // Same account confirmed → persist the fresh refresh token (best-effort: a
  // keyring-less Linux box can't save it, but the id-token in hand still works).
  if (tokens.refresh_token) {
    try { saveRefreshToken(tokens.refresh_token); } catch { /* non-fatal */ }
  }
  return { ok: true, idToken: tokens.id_token };
}

/**
 * Read the live tier for `idToken` by exchanging it at /entitlement, so a menu
 * action routes on current state instead of the (possibly stale) session tier.
 * Unlike ensureEntitlement this does NOT fall back to the cached grace window —
 * a manual action wants the live answer, or an honest failure.
 *
 * @returns {Promise<object>} one of:
 *   { identity }     // entitled — identity.tier is authoritative
 *   { proRequired }  // authenticated but not entitled → must pay (Checkout)
 *   { error }        // offline / server / revoked — caller falls back to session tier
 */
async function fetchCurrentTier(idToken) {
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
    return { error: (err && err.message) || 'network error' };
  }
  if (res.ok) {
    try {
      const { entitlement } = await res.json();
      const claims = await verifyEntitlement(entitlement);
      try { saveEntitlement(entitlement); } catch { /* non-fatal */ }
      return { identity: claims };
    } catch (err) {
      return { error: (err && err.message) || 'invalid entitlement' };
    }
  }
  const text = await res.text();
  let code = null;
  let message = null;
  try {
    const parsed = JSON.parse(text);
    code = parsed.error || null;
    message = parsed.message || null;
  } catch { /* body wasn't JSON */ }
  if (code === 'pro_required') return { proRequired: true };
  if (code === 'access_revoked') return { revoked: true, message };
  return { error: `HTTP ${res.status}` };
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
  getActionIdToken,
  fetchCurrentTier,
};
