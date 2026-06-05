// Native OAuth 2.0 PKCE flow per RFC 8252.
// Authenticates against Google, returns Google ID token + refresh token.
//
// Pure Node — no Electron deps. The browser-launcher is injected so this
// module is testable standalone via test-auth.js.

const http = require('http');
const crypto = require('crypto');

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(buf) {
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  );
  return { verifier, challenge };
}

function generateState() {
  return base64url(crypto.randomBytes(16));
}

// Bind a loopback HTTP server on an ephemeral port and wait for /callback.
// Returns { redirectUri, waitForCallback } where waitForCallback resolves
// with the auth code (or rejects on error/timeout/state-mismatch).
function startLoopbackServer({ expectedState, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolveOuter, rejectOuter) => {
    let server;
    let timer;

    const callbackPromise = new Promise((resolveCb, rejectCb) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');

        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const code  = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const err   = url.searchParams.get('error');

        const respond = (body) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
        };

        if (err) {
          respond('<h1>Sign-in failed</h1><p>You may close this tab.</p>');
          rejectCb(new Error(`OAuth error: ${err}`));
        } else if (state !== expectedState) {
          // RFC 6749 §10.12 — state mismatch is a CSRF signal. Reject.
          respond('<h1>Sign-in failed</h1><p>State mismatch.</p>');
          rejectCb(new Error('State mismatch'));
        } else if (!code) {
          respond('<h1>Sign-in failed</h1><p>No code received.</p>');
          rejectCb(new Error('No code in callback'));
        } else {
          respond('<h1>Signed in</h1><p>You may close this tab and return to iDEP.</p>');
          resolveCb(code);
        }

        clearTimeout(timer);
        setTimeout(() => { try { server.close(); } catch {} }, 100);
      });

      timer = setTimeout(() => {
        try { server.close(); } catch {}
        rejectCb(new Error(`Timed out waiting for callback after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    // RFC 8252 §8.3 — bind to the IPv4 literal, not "localhost".
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      resolveOuter({ redirectUri, waitForCallback: () => callbackPromise });
    });

    server.on('error', rejectOuter);
  });
}

function buildAuthURL({ clientId, redirectUri, codeChallenge, state, scopes }) {
  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             clientId,
    redirect_uri:          redirectUri,
    scope:                 scopes.join(' '),
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type:           'offline',
    // select_account → always show the Google account chooser (multi-account
    // machines / "switch account"). consent → guarantees a refresh_token.
    prompt:                'select_account consent',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

async function exchangeCodeForTokens({
  clientId, clientSecret, code, codeVerifier, redirectUri,
}) {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Silently obtain a fresh Google id-token from a stored refresh token — no
 * browser, no user interaction (RFC 6749 §6, grant_type=refresh_token).
 *
 * Google does not return a new refresh_token on this grant, so the caller
 * keeps the one it already has. Throws on any non-2xx (e.g. the refresh token
 * was revoked or has expired) so the caller can fall back to interactive login.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.refreshToken
 * @returns {Promise<object>} { id_token, access_token, expires_in, ... }
 */
async function refreshIdToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    // httpStatus present ⇒ Google rejected the grant (e.g. 400 invalid_grant:
    // refresh token revoked/expired). A network failure rejects `fetch` with
    // no httpStatus, so the caller can tell "revoked" from "offline" apart.
    const err = new Error(`Refresh failed (${res.status}): ${text}`);
    err.httpStatus = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Run the full PKCE flow end-to-end.
 *
 * @param {object} opts
 * @param {string}   opts.clientId
 * @param {string}   opts.clientSecret  - Per RFC 8252 §8.5 the secret is non-secret
 *                                        for desktop apps, but Google still requires it.
 * @param {string[]} [opts.scopes]
 * @param {function(string):void} opts.openInBrowser
 * @returns {Promise<object>} { id_token, access_token, refresh_token, expires_in, ... }
 */
async function runPKCEFlow({
  clientId,
  clientSecret,
  scopes = ['openid', 'email', 'profile'],
  openInBrowser,
}) {
  const { verifier, challenge } = generatePKCE();
  const state = generateState();

  const { redirectUri, waitForCallback } = await startLoopbackServer({
    expectedState: state,
  });

  const authUrl = buildAuthURL({
    clientId,
    redirectUri,
    codeChallenge: challenge,
    state,
    scopes,
  });

  openInBrowser(authUrl);

  const code = await waitForCallback();

  return exchangeCodeForTokens({
    clientId, clientSecret, code, codeVerifier: verifier, redirectUri,
  });
}

module.exports = {
  runPKCEFlow,
  refreshIdToken,
  // exported for unit testing
  generatePKCE,
  generateState,
  startLoopbackServer,
  buildAuthURL,
  exchangeCodeForTokens,
};
