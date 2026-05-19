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

let cachedPublicKey = null;

async function loadPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  cachedPublicKey = await importSPKI(pem, EXPECTED_ALG);
  return cachedPublicKey;
}

/**
 * Verify an entitlement JWT and return its claims.
 *
 * Verifies: signature (ES256), issuer, audience, exp.
 * Does NOT enforce grace_until — that's a separate check (see isValid).
 *
 * @param {string} jwt - The entitlement JWT received from /entitlement
 * @returns {Promise<object>} The verified claims
 * @throws {Error} On signature failure, expiry, or claim mismatch
 */
async function verifyEntitlement(jwt) {
  const publicKey = await loadPublicKey();
  const { payload } = await jwtVerify(jwt, publicKey, {
    algorithms: [EXPECTED_ALG],
    issuer:     EXPECTED_ISSUER,
    audience:   EXPECTED_AUDIENCE,
  });
  return payload;
}

/**
 * Decide whether a verified entitlement is currently usable.
 *
 * Three states:
 *   - "valid"   : exp not passed, full Pro features
 *   - "grace"   : exp passed but grace_until still in the future (offline OK)
 *   - "expired" : both exp and grace_until passed (downgrade to Free)
 *
 * @param {object} claims - Output of verifyEntitlement
 * @param {number} [nowSec] - Current time in seconds (for testing); defaults to real time
 * @returns {"valid"|"grace"|"expired"}
 */
function entitlementStatus(claims, nowSec = Math.floor(Date.now() / 1000)) {
  if (nowSec < claims.exp) return 'valid';
  if (claims.grace_until && nowSec < claims.grace_until) return 'grace';
  return 'expired';
}

module.exports = {
  verifyEntitlement,
  entitlementStatus,
  // exported for testing
  loadPublicKey,
  PUBLIC_KEY_PATH,
};
