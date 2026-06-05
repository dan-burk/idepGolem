// Entitlement JWT verification + offline-grace check.
//
// The /entitlement Cloud Function signs JWTs with our ES256 private key
// (in GCP Secret Manager). We verify those JWTs locally with the embedded
// public key. This means the Electron app can trust a cached entitlement
// without re-contacting Google/Stripe on every launch.

const fs = require('fs');
const path = require('path');
const { jwtVerify, importSPKI } = require('jose');

// Public key lives next to this file. It's committed to the repo —
// public by design (see ../auth-pricing-setup/auth-setup-instructions.md).
const PUBLIC_KEY_PATH = path.join(__dirname, 'keys', 'idep-entitlement-public.pem');

// Must match the function's setIssuer() / setAudience() values.
const EXPECTED_ISSUER   = 'idep-entitlement';
const EXPECTED_AUDIENCE = 'idep-desktop';
const EXPECTED_ALG      = 'ES256';

// Offline grace: how long past the JWT's `exp` we keep honoring a cached
// entitlement when GCP can't be reached to refresh it. A client-side constant
// (no longer a server-signed `grace_until` claim), anchored to `exp` so a
// misbehaving client can't extend its own window.
const GRACE_PERIOD_SEC = 24 * 60 * 60; // 24h

let cachedPublicKey = null;

async function loadPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  cachedPublicKey = await importSPKI(pem, EXPECTED_ALG);
  return cachedPublicKey;
}

/**
 * Verify an entitlement JWT's signature and claims, returning its payload.
 *
 * Strictly enforces signature (ES256), issuer, and audience. Expiry is handled
 * leniently on purpose: `clockTolerance` lets jose return the claims for a
 * token up to GRACE_PERIOD_SEC past `exp` instead of throwing, so the
 * valid/grace/expired decision can be made in entitlementStatus (the offline
 * grace window). A token older than exp + grace still throws — unusable.
 *
 * @param {string} jwt - The entitlement JWT received from /entitlement
 * @returns {Promise<object>} The verified claims
 * @throws {Error} On signature failure, issuer/audience mismatch, or a token
 *   more than GRACE_PERIOD_SEC past expiry
 */
async function verifyEntitlement(jwt) {
  const publicKey = await loadPublicKey();
  const { payload } = await jwtVerify(jwt, publicKey, {
    algorithms:     [EXPECTED_ALG],
    issuer:         EXPECTED_ISSUER,
    audience:       EXPECTED_AUDIENCE,
    clockTolerance: GRACE_PERIOD_SEC,
  });
  return payload;
}

/**
 * Decide whether a verified entitlement is currently usable, from `exp` alone.
 *
 * Three states:
 *   - "valid"   : within `exp` — use as-is, no need to re-check with GCP
 *   - "grace"   : past `exp` but within `exp + GRACE_PERIOD_SEC` — must try to
 *                 refresh; usable as a fallback only if the refresh can't reach GCP
 *   - "expired" : past `exp + GRACE_PERIOD_SEC` — unusable, must re-auth
 *
 * @param {object} claims - Output of verifyEntitlement
 * @param {number} [nowSec] - Current time in seconds (for testing); defaults to real time
 * @returns {"valid"|"grace"|"expired"}
 */
function entitlementStatus(claims, nowSec = Math.floor(Date.now() / 1000)) {
  if (nowSec < claims.exp) return 'valid';
  if (nowSec < claims.exp + GRACE_PERIOD_SEC) return 'grace';
  return 'expired';
}

module.exports = {
  verifyEntitlement,
  entitlementStatus,
};
