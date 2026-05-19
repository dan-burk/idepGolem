// HMAC secret management + per-session JWT minting for the Electron → Shiny
// handshake. The secret is generated once per install and persisted encrypted.
// The Shiny child process receives it via SHINY_HMAC_SECRET env var at spawn.
// Per Shiny session, Electron mints a short-lived JWT signed with this secret
// and injects it as Authorization: Bearer <jwt> on every request to 127.0.0.1.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const { SignJWT } = require('jose');

const SESSION_JWT_TTL_SEC = 5 * 60; // 5 minutes; refresh well before expiry

function secretFile() {
  return path.join(app.getPath('userData'), 'shiny-hmac.bin');
}

function getOrCreateHmacSecret() {
  const file = secretFile();

  if (fs.existsSync(file) && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(fs.readFileSync(file));
    } catch {
      // Corrupted cache; regenerate below
    }
  }

  const secret = crypto.randomBytes(32).toString('hex');
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(secret));
  }
  return secret;
}

async function mintSessionJWT(hmacSecret, identity) {
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(hmacSecret);
  return new SignJWT({
    email:    identity.email,
    tier:     identity.tier,
    features: identity.features || [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('idep-electron')
    .setAudience('idep-shiny')
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_JWT_TTL_SEC)
    .sign(key);
}

module.exports = {
  getOrCreateHmacSecret,
  mintSessionJWT,
  SESSION_JWT_TTL_SEC,
};
