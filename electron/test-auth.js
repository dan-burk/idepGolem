// Standalone CLI test for the PKCE OAuth flow + entitlement endpoint.
//
// Usage (PowerShell, from electron/ folder):
//   $env:GOOGLE_OAUTH_CLIENT_ID="<client-id>.apps.googleusercontent.com"
//   $env:GOOGLE_OAUTH_CLIENT_SECRET="<client-secret>"
//   node test-auth.js
//
// What it does:
//   1. Runs the PKCE OAuth flow against Google in your system browser.
//   2. Receives id_token + access_token + refresh_token.
//   3. Posts the id_token to the deployed /entitlement function.
//   4. Prints the entitlement JWT it returns.

const { exec } = require('child_process');
const { runPKCEFlow } = require('./auth');
const { verifyEntitlement, entitlementStatus } = require('./entitlement');

const ENTITLEMENT_URL = 'https://entitlement-auzgq7lgsq-uc.a.run.app';

const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.');
  process.exit(1);
}

function openInBrowser(url) {
  let cmd;
  if (process.platform === 'win32')      cmd = `cmd /c start "" "${url}"`;
  else if (process.platform === 'darwin') cmd = `open "${url}"`;
  else                                    cmd = `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error('Failed to launch browser:', err.message);
  });
}

(async () => {
  console.log('Starting Google OAuth PKCE flow…');
  console.log('Your browser should open. Sign in with your Google account.\n');

  let tokens;
  try {
    tokens = await runPKCEFlow({ clientId, clientSecret, openInBrowser });
  } catch (err) {
    console.error('\n❌ PKCE flow failed:', err.message);
    process.exit(1);
  }

  console.log('✅ Google tokens received:');
  console.log('   id_token       :', tokens.id_token?.slice(0, 60) + '…');
  console.log('   access_token   :', tokens.access_token?.slice(0, 60) + '…');
  console.log('   refresh_token  :', tokens.refresh_token ? 'present' : 'MISSING');
  console.log('   expires_in     :', tokens.expires_in, 'sec\n');

  console.log(`Calling ${ENTITLEMENT_URL}…`);
  try {
    const res = await fetch(ENTITLEMENT_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${tokens.id_token}` },
    });
    const body = await res.text();
    console.log(`HTTP ${res.status}: ${body.slice(0, 80)}…`);
    if (!res.ok) {
      console.error('\n❌ Entitlement call failed.');
      process.exit(1);
    }

    const { entitlement: entitlementJWT } = JSON.parse(body);
    console.log('\nVerifying entitlement JWT signature with embedded public key…');
    const claims = await verifyEntitlement(entitlementJWT);
    const status = entitlementStatus(claims);

    console.log('✅ Entitlement verified. Claims:');
    console.log('   email       :', claims.email);
    console.log('   tier        :', claims.tier);
    console.log('   features    :', JSON.stringify(claims.features));
    console.log('   exp         :', new Date(claims.exp * 1000).toISOString());
    console.log('   grace_until :', new Date(claims.grace_until * 1000).toISOString());
    console.log('   status      :', status);
    console.log('\n🚀 End-to-end verified: PKCE → Google → /entitlement → local signature check.');
  } catch (err) {
    console.error('\n❌ Network error calling /entitlement:', err.message);
    process.exit(1);
  }
})();
