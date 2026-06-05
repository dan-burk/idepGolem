// Encrypted at-rest cache for the entitlement JWT.
//
// Uses Electron's safeStorage (OS-backed encryption: macOS Keychain,
// Windows DPAPI, Linux Secret Service). Stored in app.getPath('userData')
// so it's per-user, per-app, and gets cleaned up with the app data.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function cacheFile() {
  return path.join(app.getPath('userData'), 'entitlement.bin');
}

function saveEntitlement(jwt) {
  if (!safeStorage.isEncryptionAvailable()) {
    // On Linux without a Secret Service backend, safeStorage silently
    // falls back to plaintext. Refuse to write rather than pretend.
    throw new Error('safeStorage encryption unavailable on this system');
  }
  const encrypted = safeStorage.encryptString(jwt);
  fs.writeFileSync(cacheFile(), encrypted);
}

function loadEntitlement() {
  const file = cacheFile();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(file);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

// Delete a file; return true if it's gone afterward (deleted, or never
// existed), false if it still exists — e.g. locked or permission denied. Lets
// sign-out detect a clear that didn't actually happen instead of failing
// silently and relaunching straight back into the same account.
function removeFile(file) {
  try { fs.unlinkSync(file); } catch { /* fall through to the existence check */ }
  return !fs.existsSync(file);
}

function clearEntitlement() {
  return removeFile(cacheFile());
}

// ---- Google refresh token ----
// Long-lived; used to mint fresh Google id-tokens silently (no browser) when
// the entitlement expires. Same OS-backed encryption as the entitlement,
// stored in a separate file so the two can be cleared independently.
function refreshTokenFile() {
  return path.join(app.getPath('userData'), 'google-refresh.bin');
}

function saveRefreshToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Match saveEntitlement: refuse to write plaintext rather than pretend.
    throw new Error('safeStorage encryption unavailable on this system');
  }
  fs.writeFileSync(refreshTokenFile(), safeStorage.encryptString(token));
}

function loadRefreshToken() {
  const file = refreshTokenFile();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function clearRefreshToken() {
  return removeFile(refreshTokenFile());
}

// Sign-out: wipe BOTH the entitlement and the refresh token, so the next
// launch has no silent path and must log in interactively (with the Google
// account chooser), letting the user switch accounts. A corrupt-cache reset
// during normal startup, by contrast, clears only the entitlement and keeps
// the refresh token so we can still recover silently.
function clearCredentials() {
  // Clear the refresh token FIRST: it's the silent-re-login path, so it's the
  // dangerous artifact to leave behind. If the second delete then fails, the
  // worst case is a lingering entitlement that expires within 24h (with no
  // refresh token left to renew it) — not indefinite silent re-auth into the
  // same account. Attempt BOTH even if the first fails (no short-circuit),
  // then report whether both files are actually gone.
  const refreshCleared = clearRefreshToken();
  const entitlementCleared = clearEntitlement();
  return refreshCleared && entitlementCleared;
}

module.exports = {
  saveEntitlement,
  loadEntitlement,
  clearEntitlement,
  saveRefreshToken,
  loadRefreshToken,
  clearRefreshToken,
  clearCredentials,
};
