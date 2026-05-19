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

function clearEntitlement() {
  try { fs.unlinkSync(cacheFile()); } catch {}
}

module.exports = { saveEntitlement, loadEntitlement, clearEntitlement };
