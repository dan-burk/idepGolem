// main.js
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const { checkForUpdates } = require('./updater');
const { ensureEntitlement, setupShinyRequestAuth, startProCheckout, startPortalSession, getActionIdToken, fetchCurrentTier } = require('./auth-integration');
const { getOrCreateHmacSecret } = require('./hmac');
const { clearCredentials } = require('./cache');
// Node 22+ (bundled in Electron 39) provides global fetch natively

// IDEP_APP=dev selects the lightweight idepGolemDev diagnostic package instead
// of the full idepGolem app. It does NOT affect authentication: the OAuth +
// entitlement check and the HMAC handshake always run, in dev and production
// alike. There is no auth bypass. Gated on !app.isPackaged so a shipped build
// always loads the real app.
const USE_DEV_PACKAGE = !app.isPackaged && process.env.IDEP_APP === 'dev';

let childProc = null;

// ---------- shutdown handlers ----------
// Registered at module top-level so they fire even if the user quits during
// startup (before createWindow finishes), which would otherwise orphan Rscript.
app.on('before-quit', () => { app.isQuitting = true; safeKill(childProc); });
app.on('window-all-closed', () => app.quit());

// ---------- logging ----------
const LOG_FILE = path.join(app.getPath('temp'), 'idep-electron.log');
function log(...args) {
  try {
    const line = args.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    fs.appendFileSync(LOG_FILE, line + '\n');
    console.log(line);
  } catch {}
}

// ---------- crash guards ----------
process.on('uncaughtException', (err) => {
  const msg = (err && err.stack) ? err.stack : String(err);
  log('[uncaughtException]', msg);
  try { dialog.showErrorBox('Uncaught Exception', msg); } catch {}
});
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.stack) ? reason.stack : String(reason);
  log('[unhandledRejection]', msg);
});

// ---------- single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => {
  if (global.win) {
    if (global.win.isMinimized()) global.win.restore();
    global.win.focus();
  }
});

// ---------- helpers ----------
function getRuntime() {
  const rp = app.isPackaged ? process.resourcesPath : __dirname;

  if (process.platform === 'win32') {
    const R_ROOT = path.join(rp, 'runtime', 'R.win');
    const binDir = path.join(R_ROOT, 'bin');
    const rscript = path.join(binDir, 'Rscript.exe');
    if (!fs.existsSync(rscript)) {
      const msg = `Could not locate bundled Rscript.exe.\nresourcesPath: ${rp}\nExpected at: ${rscript}\n`;
      log('[FATAL]', msg);
      try { dialog.showErrorBox('Rscript.exe Not Found', msg + `\nLog: ${LOG_FILE}`); } catch {}
      return null;
    }
    const libDir = path.join(R_ROOT, 'library');
    log('[R runtime]', 'R_ROOT=', R_ROOT, 'libDir=', libDir, 'rscript=', rscript);

    return {
      rscript,
      env: {
        R_HOME: R_ROOT,
        R_USER: R_ROOT,
        // Isolate the bundled runtime: never inherit a host site library,
        // so a relocated R uses only the bundled package tree. R_LIBS_USER
        // (the bundled library dir) is set at the spawn call below.
        R_LIBS_SITE: '',
        PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(';'),
      },
    };
  }

  if (process.platform === 'darwin') {
    const rscript = path.join(rp, 'runtime', 'R.framework', 'Resources', 'bin', 'Rscript');
    if (!fs.existsSync(rscript)) {
      log('[macOS] Rscript not found at ' + rscript);
      try { dialog.showErrorBox('Rscript Not Found', 'Bundle R.framework under runtime/.\nSee log: ' + LOG_FILE); } catch {}
      return null;
    }
    const R_RES = path.dirname(path.dirname(rscript)); // .../R.framework/Resources
    return {
      rscript,
      env: {
        R_HOME: R_RES,
        DYLD_FALLBACK_LIBRARY_PATH: path.join(R_RES, 'lib'),
        PATH: [path.join(R_RES, 'bin'), process.env.PATH || ''].filter(Boolean).join(':'),
      },
    };
  }

  // linux
  const R_ROOT = path.join(rp, 'runtime', 'R.linux');
  const binDir = path.join(R_ROOT, 'bin');
  const rscript = path.join(binDir, 'Rscript');
  if (!fs.existsSync(rscript)) {
    log('[linux] Rscript not found at ' + rscript);
    try { dialog.showErrorBox('Rscript Not Found', 'Bundle R under runtime/R.linux/.\nSee log: ' + LOG_FILE); } catch {}
    return null;
  }
  return {
    rscript,
    env: {
      R_HOME: R_ROOT,
      LD_LIBRARY_PATH: [path.join(R_ROOT, 'lib'), process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':'),
      PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(':'),
    },
  };
}

// Return true if 'p' is a directory I can write to; otherwise false."
function isWritableDir(p) {
  try {
    fs.accessSync(p, fs.constants.W_OK);
    return fs.statSync(p).isDirectory();
  } catch { return false; }
}

// "If there's no process to kill, OR there is one but we already killed it, bail out."
function safeKill(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      // SIGTERM doesn't reliably kill R on Windows — httpuv ignores it.
      // taskkill /T kills the entire process tree (Rscript + child R).
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      // SIGTERM is the standard graceful shutdown on Linux/macOS.
      proc.kill('SIGTERM');
    }
  } catch (e) {
    log('[safeKill]', e && e.message ? e.message : String(e));
  }
}

async function waitForHttp(url, { timeoutMs = 120000, intervalMs = 500 } = {}) {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const ctrl = new AbortController();
      // First response from Shiny can take 10-30s while it renders 12 modules,
      // loads databases, and initializes reactive contexts.  The old 2s abort
      // killed every attempt before Shiny could finish, causing the timeout.
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(to);
      // Any HTTP response proves the server is alive — even a 500 during
      // heavy startup.  Don't filter by status.
      log(`[waitForHttp] attempt ${attempts}: got HTTP ${res.status} — server is alive`);
      return true;
    } catch (err) {
      if (attempts <= 3 || attempts % 10 === 0) {
        log(`[waitForHttp] attempt ${attempts}: ${err.name}: ${err.message}`);
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// "Try to open a TCP server on start. If it fails (port in use), recurse with start + 1. If it succeeds, grab the 
//      actual port number, close the server, and return that port."
function getFreePort(start = 7777, end = 7999) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      if (start < end) resolve(getFreePort(start + 1, end));
      else reject(new Error('No free ports'));
    });
    server.listen(start, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// update splash progress bar + taskbar progress
// "If a window exists, push the progress fraction to both the taskbar AND the in-window splash JS —
//  silently no-op on any failure."
function setSplashProgress(progress, statusText) {
  if (!global.win) return;
  try {
    // Taskbar / dock progress
    if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
      global.win.setProgressBar(progress);
    } else {
      global.win.setProgressBar(-1); // clear
    }

    // In-window bar + text
    const pct = typeof progress === 'number' ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : 0;
    const js = `
      if (window.updateSplash) {
        window.updateSplash(${pct}, ${statusText ? JSON.stringify(statusText) : 'null'});
      }
    `;
    global.win.webContents.executeJavaScript(js).catch(() => {});
  } catch {}
}

// Desktop-only keep-alive. Shiny greys out when its WebSocket sits idle, and
// there is no runApp idle-timeout setting to raise — so we nudge the server
// from the renderer every 30s to keep the socket warm. Injected by the shell,
// so the web deployment is never affected. Re-injected on every page load so it
// survives the splash -> app navigation and any reload. The guard prevents a
// duplicate timer within a single page; the no-op when Shiny is absent covers
// the splash page.
const HEARTBEAT_JS = `(function () {
  if (window.__idepHeartbeat) return;
  window.__idepHeartbeat = setInterval(function () {
    try {
      var send = window.Shiny && (Shiny.setInputValue || Shiny.onInputChange);
      if (send) send.call(Shiny, '.idepHeartbeat', Date.now(), { priority: 'event' });
    } catch (e) {}
  }, 30000);
})();`;

function showPlaceholder() {
  if (global.win) return;
  global.win = new BrowserWindow({
    width: 900,
    height: 500,
    show: true,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Keep renderer timers running when the window is minimized/hidden so the
      // heartbeat below keeps firing instead of being frozen by Chromium.
      backgroundThrottling: false,
    },
  });

  // Re-inject the keep-alive heartbeat after every load (splash + app + reloads).
  global.win.webContents.on('did-finish-load', () => {
    global.win.webContents.executeJavaScript(HEARTBEAT_JS).catch(() => {});
  });

  const splashPath = path.join(__dirname, 'splash.html');
  const html = fs.readFileSync(splashPath, 'utf8')
    .replace('{{LOG_FILE}}', LOG_FILE.replace(/\\/g, '/'))
    .replace('{{APP_VERSION}}', app.getVersion());

  global.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ---------- application menu ----------
// Sign Out: clear BOTH the cached entitlement and the Google refresh token,
// then relaunch. Clearing the refresh token is what actually forces a fresh
// login — otherwise the next launch would silently refresh straight back into
// the same account. With select_account, the user can then pick a different one.
async function signOutFlow() {
  const win = global.win;
  const opts = {
    type: 'question',
    buttons: ['Sign Out', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Sign Out',
    message: 'Sign out of iDEP?',
    detail: 'iDEP will close and restart. You will need to sign in again.',
  };
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  if (response !== 0) return;

  log('[auth] Sign out requested — clearing cached credentials');
  let cleared = false;
  try {
    cleared = clearCredentials();
  } catch (e) {
    log('[auth] clearCredentials threw', e && e.message);
  }

  if (!cleared) {
    // A credential file could not be removed (locked / permission). Do NOT
    // relaunch — that would silently sign the user back into the same account
    // while looking like sign-out succeeded. Tell them instead.
    log('[auth] Sign out FAILED — credential files could not be removed');
    const failOpts = {
      type: 'error',
      buttons: ['OK'],
      title: 'Sign Out Failed',
      message: 'iDEP could not sign you out.',
      detail: 'A credential file could not be removed (it may be in use). ' +
        'Please fully quit iDEP and retry. If the issue persists, contact us ' +
        'at info@orditus.com.\n\nLog: ' + LOG_FILE,
    };
    if (win) await dialog.showMessageBox(win, failOpts);
    else await dialog.showMessageBox(failOpts);
    return;
  }

  app.isQuitting = true;
  app.relaunch(); //Schedule relaunch
  app.quit();
}

// ---------- Manage subscription (Account menu) ----------
// "Right door" routing: a subscriber (tier 'pro' — trialing or active) goes to
// the Customer Portal to manage/cancel; a free user goes to Checkout to start
// paying. A trialing user therefore NEVER hits Checkout (which would create a
// second subscription).
//
// Auth: re-mint a Google id-token for the CURRENT account — silently from the
// stored refresh token, or, if that's gone/revoked, via an interactive login
// pinned to this account (no account chooser). Switching accounts mid-session
// is not allowed; the only way to switch is Sign Out → Sign In. The routing
// tier is re-fetched from the fresh token so it can't act on a stale session.
let manageInFlight = false; // one Manage Subscription flow at a time (no double-click)

async function manageSubscriptionFlow() {
  const identity = global.identity;
  if (!identity) return;       // not signed in yet
  if (manageInFlight) return;  // ignore re-entrant clicks
  manageInFlight = true;
  try {
    // Fresh id-token for the current account (silent, else pinned popup).
    const tok = await getActionIdToken(identity.email);
    if (!tok.ok) {
      if (tok.reason === 'account_mismatch') {
        dialog.showErrorBox(
          'Wrong Account',
          `You signed in as ${tok.email || 'a different account'}, but iDEP is ` +
          `signed in as ${identity.email}.\n\nTo switch accounts, use ` +
          `Account → Sign Out, then sign in again.`,
        );
      } else if (tok.reason === 'network_error') {
        dialog.showErrorBox(
          'Connection Problem',
          'Could not reach the sign-in server. Check your internet connection ' +
          'and try again.',
        );
      } else {
        dialog.showErrorBox(
          'Sign-in Incomplete',
          'Sign-in did not complete. Please try again.',
        );
      }
      return;
    }
    const idToken = tok.idToken;

    // Route on the LIVE tier for this account, not the (possibly stale) session
    // tier — e.g. a user who subscribed earlier this session must reach the
    // Portal, not Checkout. On a lookup failure, fall back to the session tier.
    let tier = identity.tier;
    const tierRes = await fetchCurrentTier(idToken);
    if (tierRes.revoked) {
      // Access deliberately revoked — don't route to Portal/Checkout at all.
      await showAccessRevokedDialog({ message: tierRes.message });
      return;
    }
    if (tierRes.identity) {
      tier = tierRes.identity.tier;
      global.identity = tierRes.identity; // keep the menu's identity current
    } else if (tierRes.proRequired) {
      tier = 'free';                       // authenticated but not entitled → pay
    } // else: lookup failed — keep the session tier as a best-effort fallback

    if (tier === 'pro') {
      // Subscriber → Customer Portal (manage payment method / cancel / invoices).
      try {
        const portalUrl = await startPortalSession(idToken);
        await shell.openExternal(portalUrl);
      } catch (e) {
        log('[portal error]', e && e.message ? e.message : String(e));
        try {
          dialog.showErrorBox(
            'Manage Subscription Error',
            `Could not open the billing portal: ${e && e.message ? e.message : String(e)}`,
          );
        } catch {}
      }
    } else {
      // Free → Checkout to start paying. Reuses the shared checkout opener.
      await openProCheckout(idToken);
    }
  } finally {
    manageInFlight = false;
  }
}

function buildAppMenu() {
  const template = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
  ];

  // Auth always runs, so there is always an account to sign out of.
  template.push({
    label: 'Account',
    submenu: [
      { label: 'Manage Subscription', click: () => manageSubscriptionFlow() },
      { type: 'separator' },
      { label: 'Sign Out', click: () => signOutFlow() },
    ],
  });

  return Menu.buildFromTemplate(template);
}

// Releases page for the "Update" action — the human-facing page where users
// download the latest build. Override via RELEASES_PAGE in electron/.env
// (loaded by auth-integration.js on require); falls back to GitHub releases.
const RELEASES_PAGE = process.env.RELEASES_PAGE ||
  'https://github.com/dan-burk/idepGolem/releases/latest';

// Open Stripe Checkout for Pro in the system browser, then tell the user to
// finish there. Shared by the trial-ended and update-required dialogs.
async function openProCheckout(idToken) {
  try {
    const checkoutUrl = await startProCheckout(idToken);
    await shell.openExternal(checkoutUrl);
    await dialog.showMessageBox({
      type: 'info',
      buttons: ['OK'],
      title: 'Finish in your browser',
      message: 'Complete your purchase in the browser window that opened.',
      detail: 'Once payment is approved, reopen iDEP — you will have Pro access.',
    });
  } catch (e) {
    log('[checkout error]', e && e.message ? e.message : String(e));
    try {
      dialog.showErrorBox(
        'Upgrade Error',
        `Could not start checkout: ${e && e.message ? e.message : String(e)}`,
      );
    } catch {}
  }
}

// ---------- Pro upgrade dialog ----------
// Shown when /entitlement denies a free user with reason 'pro_required' — the
// trial is over. Offers to open Stripe Checkout in the system browser.
async function showProUpgradeDialog(result) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Upgrade to Pro', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'iDEP Trial Ended',
    message: 'Your iDEP free trial has ended.',
    detail: (result && result.message) ||
      'Upgrade to iDEP Pro to keep using the desktop app.',
  });
  if (response !== 0) return; // "Quit" chosen — nothing more to do.
  await openProCheckout(result.idToken); // "Upgrade to Pro" chosen.
}

// ---------- Update required dialog ----------
// Shown when /entitlement denies a FREE user with reason 'update_required' —
// their build is older than the free tier's minimum version. They can update
// the app, or upgrade to Pro (never version-gated) to keep running their
// current version. The app quits afterward either way (the auth gate failed).
async function showUpdateRequiredDialog(result) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Update', 'Upgrade to Pro', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    title: 'Update Required',
    message: 'A newer version of iDEP is required on the free tier.',
    detail: (result && result.message) ||
      'Update to the latest release, or upgrade to Pro to keep using your ' +
      'current version.',
  });

  if (response === 0) {
    await shell.openExternal(RELEASES_PAGE); // "Update" → download latest.
  } else if (response === 1) {
    await openProCheckout(result.idToken);   // "Upgrade to Pro" → keep version.
  }
  // response === 2 ("Quit"): nothing.
}

// ---------- Access revoked dialog ----------
// Shown when /entitlement denies a user with reason 'access_revoked' — their
// access was deliberately revoked (admin action), not a transient error, so
// they get a tailored message pointing at support rather than a raw error box.
async function showAccessRevokedDialog(result) {
  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['OK'],
    title: 'Access Revoked',
    message: 'Your iDEP access has been revoked.',
    detail: (result && result.message) ||
      'Please contact support if you believe this is in error.',
  });
}

// Load the Shiny URL with retries. loadURL()'s promise can reject with
// ERR_ABORTED/ERR_FAILED even when the page actually loads — Shiny replaces the
// initial navigation with its own, which aborts the first load. A genuinely
// not-quite-ready server can also need a second attempt. So: retry a few times,
// and treat "the page finished loading" as success regardless of whether the
// promise rejected. Only the caller's catch (→ Load Error dialog) fires if every
// attempt fails AND nothing ever finished loading.
async function loadAppURL(win, url, { attempts = 3, delayMs = 750 } = {}) {
  const wc = win.webContents;
  let finished = false;      // a navigation finished loading this attempt
  let mainFrameFail = null;  // last HARD main-frame failure (not a benign abort)
  const onFinish = () => { finished = true; };
  // -3 = ERR_ABORTED: a superseded/replaced navigation (Shiny does this on its
  // first paint) — benign. Any other main-frame error is a real failure,
  // INCLUDING a dead server whose Chromium error page still fires did-finish-load.
  const onFail = (_e, errorCode, _desc, _failedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) mainFrameFail = errorCode;
  };
  wc.on('did-finish-load', onFinish);
  wc.on('did-fail-load', onFail);
  try {
    for (let i = 1; i <= attempts; i++) {
      finished = false;
      mainFrameFail = null;
      try {
        await win.loadURL(url);
        return; // clean load
      } catch (e) {
        // Give any superseding navigation a moment to finish before judging.
        await new Promise((r) => setTimeout(r, delayMs));
        // Success only if the page actually finished AND no hard main-frame
        // failure is outstanding — so a benign aborted-then-loaded navigation
        // passes, but a genuinely dead server still surfaces the dialog.
        if (finished && mainFrameFail === null) return;
        log(`[loadURL] attempt ${i}/${attempts} failed: ${e && e.message ? e.message : String(e)}`);
        if (i === attempts) throw e;
      }
    }
  } finally {
    wc.removeListener('did-finish-load', onFinish);
    wc.removeListener('did-fail-load', onFail);
  }
}

// ---------- bootstrap ----------
async function createWindow() {
  const host = '127.0.0.1';
  const port = await getFreePort();
  let shinyPortFromLog = null; // track port reported by Shiny

  const RESOURCES_DIR = process.resourcesPath;
  const APP_DIR = app.isPackaged
    ? path.join(RESOURCES_DIR, 'app')
    : path.join(__dirname, 'app');

  // show splash early
  showPlaceholder();

  // --- Auth gate ---
  // Always run the OAuth + entitlement check before spawning R — there is no
  // dev bypass. On failure, show a dialog and quit without launching R.
  let identity = null;
  let hmacSecret = null;
  {
    const result = await ensureEntitlement((pct, text) => setSplashProgress(pct, text));
    if (result.ok) {
      identity = result.identity;
      global.identity = identity; // expose tier/email to the Account-menu actions
      hmacSecret = getOrCreateHmacSecret();
      log('[auth]', `Signed in as ${identity.email} (tier=${identity.tier}, fromCache=${result.fromCache})`);
    } else {
      // Known failure: route business outcomes to their own dialog, real
      // errors to the generic box. The default branch surfaces any reason
      // added upstream that we haven't handled here yet.
      switch (result.reason) {
        case 'pro_required':
          log('[auth]', 'Entitlement denied (pro_required) — showing upgrade dialog');
          await showProUpgradeDialog(result);
          break;
        case 'update_required':
          log('[auth]', 'Entitlement denied (update_required) — showing update dialog');
          await showUpdateRequiredDialog(result);
          break;
        case 'access_revoked':
          log('[auth]', 'Entitlement denied (access_revoked) — showing revoked dialog');
          await showAccessRevokedDialog(result);
          break;
        case 'auth_failed':
        case 'network_error':
        case 'server_error':
          log('[auth error]', `Sign-in failed (${result.reason}): ${result.message}`);
          try { dialog.showErrorBox('Sign-in Failed', result.message || 'Sign-in failed.'); } catch {}
          break;
        default:
          log('[auth error]', `Unknown failure reason: ${result.reason}`);
          try { dialog.showErrorBox('Sign-in Failed', `Unknown failure: ${result.reason}`); } catch {}
      }
      app.quit(); return;
    }
  }

  setSplashProgress(0.1, 'Preparing data directory…');

  // demo data directory under app
  const DEMO_DIR = path.join(APP_DIR, 'data113');
  let demoDirExists = false;
  try {
    demoDirExists = fs.existsSync(DEMO_DIR) && fs.readdirSync(DEMO_DIR).length > 0;
  } catch {}
  log('[demo data]', 'DEMO_DIR =', DEMO_DIR, 'exists =', demoDirExists);

  // data dir
  // "if the directory the user launched from is real, isn't root, and is writable, drop the idep/ data folder right next to them;
  //    otherwise fall back to the OS's user-data location."
  const LAUNCH_DIR = process.cwd();
  // IDEP_DATA_DIR is canonical. IDEP_DATABASE is accepted as a legacy alias
  // for users with existing launch scripts and server deployments.
  const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;
  let DATA_PARENT;
  if (overrideDir) DATA_PARENT = path.resolve(overrideDir);
  else if (LAUNCH_DIR && LAUNCH_DIR !== '/' && isWritableDir(LAUNCH_DIR)) DATA_PARENT = path.join(LAUNCH_DIR, 'idep');
  else DATA_PARENT = path.join(app.getPath('userData'), 'idep');
  try {
    fs.mkdirSync(DATA_PARENT, { recursive: true });
  } catch (e) {
    const msg = `Could not create data directory at ${DATA_PARENT}\n${e.message}\nLog: ${LOG_FILE}`;
    log('[FATAL]', msg);
    try { dialog.showErrorBox('Data Directory Error', msg); } catch {}
    app.quit(); return;
  }

  // sanity — the dev package (idepGolemDev) loads directly, so app.R isn't needed
  if (!USE_DEV_PACKAGE) {
    const appR = path.join(APP_DIR, 'app.R');
    if (!fs.existsSync(appR)) {
      const msg = `Missing app/app.R.\nLooked at: ${appR}\nLog: ${LOG_FILE}`;
      log('[FATAL]', msg);
      try { dialog.showErrorBox('Missing app.R', msg); } catch {}
      app.quit(); return;
    }
  }

  // runtime
  const runtime = getRuntime();
  if (!runtime) { app.quit(); return; }
  const { rscript, env } = runtime;
  setSplashProgress(0.25, 'R runtime located…');

  // bootstrap.R is shipped as a static file — no runtime generation needed.
  // All config is passed via environment variables in the spawn call below.
  const bootstrapPath = path.join(__dirname, 'bootstrap.R');
  if (!fs.existsSync(bootstrapPath)) {
    const msg = `Missing bootstrap.R at ${bootstrapPath}\nLog: ${LOG_FILE}`;
    log('[FATAL]', msg);
    try { dialog.showErrorBox('Missing bootstrap.R', msg); } catch {}
    app.quit(); return;
  }

  log(`=== Launch ${new Date().toISOString()} ===`);
  log(`resourcesPath = ${RESOURCES_DIR}`);
  log(`APP_DIR       = ${APP_DIR}`);
  log(`DATA_PARENT   = ${DATA_PARENT}`);
  log(`Rscript       = ${rscript}`);
  log(`bootstrap.R   = ${bootstrapPath}`);

  setSplashProgress(0.35, 'Starting R bootstrap…');

  // Remove stale port file from previous launch so we don't read an old port
  const stalePortFile = path.join(DATA_PARENT, 'idep_port.txt');
  try { fs.unlinkSync(stalePortFile); } catch (_) {}

  // spawn R
  try {
    childProc = spawn(rscript, ['--vanilla', bootstrapPath], {
      cwd: DATA_PARENT,
      env: {
        ...process.env,
        ...env,
        IDEP_DATA_DIR: DATA_PARENT,   // canonical data-directory variable
        IDEP_DATABASE: DATA_PARENT,   // legacy alias: run_app.R / RMD workflows still read it
        IDEP_APP_DIR: APP_DIR,
        IDEP_HOST: host,
        IDEP_PORT: String(port),
        IDEP_DEMO_DIR: DEMO_DIR, // pass demo dir hint to R
        R_LIBS_USER: path.join(path.dirname(rscript), '..', 'library'),
        // Phase 2d: Shiny verifies the per-session JWT signed with this secret.
        // Empty string when auth is disabled so R-side can detect that state.
        SHINY_HMAC_SECRET: hmacSecret || '',
      },
      windowsHide: true,
    });
  } catch (e) {
    const msg = `Failed to spawn Rscript: ${e && e.stack ? e.stack : String(e)}\nLog: ${LOG_FILE}`;
    log('[spawn error]', msg);
    try { dialog.showErrorBox('R Launch Error', msg); } catch {}
    app.quit(); return;
  }

  setSplashProgress(0.5, 'Starting embedded R session…');

  childProc.stdout.on('data', d => log('[R stdout]', String(d).trim()));

  childProc.stderr.on('data', d => {
    const text = String(d);
    log('[R stderr]', text.trim());

    const m = text.match(/Listening on http:\/\/[^:]+:(\d+)/);
    if (m) {
      shinyPortFromLog = Number(m[1]);
      log(`[port detect] Shiny reports listening on port ${shinyPortFromLog}`);
    }
  });

  childProc.on('close', (code, sig) => {
    log('[R exit]', `code=${code||0}`, sig ? `sig=${sig}` : '');
    if (!app.isQuitting) {
      const html = `
        <html><body style="font-family:sans-serif;padding:16px">
          <h2>Server terminated</h2>
          <p>R exited with code: <b>${code ?? 0}</b> ${sig ? `(signal: ${sig})` : ''}</p>
          <p>See log:</p>
          <pre style="white-space:pre-wrap">${LOG_FILE.replace(/\\/g,'/')}</pre>
        </body></html>`;
      if (!global.win) {
        global.win = new BrowserWindow({
          width: 1200, height: 800, show: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false }
        });
      }
      global.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    }
  });

  // Wait for Shiny's stderr "Listening on" message — the only reliable
  // signal that Shiny has actually bound a port and is ready for HTTP.
  // The port file (idep_port.txt) is written *before* runApp() with the
  // requested port, which may differ from the actual port Shiny uses.
  setSplashProgress(0.6, 'Waiting for Shiny to start…');
  const listenDeadline = Date.now() + 600000; // 10 min (covers first-launch downloads)

  while (shinyPortFromLog === null && Date.now() < listenDeadline) {
    if (childProc.exitCode !== null) {
      log('[port detect] R exited before Shiny started (code ' + childProc.exitCode + ')');
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  let targetPort;
  if (shinyPortFromLog !== null) {
    targetPort = shinyPortFromLog;
  } else {
    // Fallback: try the port file, then the originally requested port
    const portFile = path.join(DATA_PARENT, 'idep_port.txt');
    try {
      const val = fs.readFileSync(portFile, 'utf8').trim();
      if (/^\d+$/.test(val)) targetPort = Number(val);
    } catch {}
    if (!targetPort) targetPort = port;
    log('[port fallback] Shiny never reported listening; trying port ' + targetPort);
  }

  const finalURL = `http://${host}:${targetPort}`;
  log(`Final targetURL = ${finalURL}`);
  setSplashProgress(0.7, 'Connecting to Shiny server…');

  // Phase 2d: inject HMAC-signed JWT on every request to the Shiny URL.
  // Done before loadURL so the very first request (HTML fetch) is authenticated.
  if (hmacSecret && identity) {
    setupShinyRequestAuth({ host, port: targetPort, hmacSecret, identity, log });
  }

  try {
    await waitForHttp(finalURL, { timeoutMs: 120000, intervalMs: 1000 });
  } catch (err) {
    log('[waitForHttp] Timeout/Error:', err && (err.stack || String(err)));
    try { dialog.showErrorBox('Startup Timeout', `Shiny reported listening on port ${targetPort} but did not respond to HTTP within 120s.\nSee log: ${LOG_FILE}`); } catch {}
    safeKill(childProc);
    return;
  }

  setSplashProgress(0.9, 'Loading user interface…');

  // Show app
  try {
    if (!global.win) {
      global.win = new BrowserWindow({
        width: 1200, height: 800,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      });
    }
    await loadAppURL(global.win, finalURL);
    setSplashProgress(-1, ''); // clear taskbar progress
    // 5s delay keeps the GitHub fetch out of Shiny startup contention.
    setTimeout(() => {
      checkForUpdates(global.win).catch(e => log('[update check]', e && e.message ? e.message : String(e)));
    }, 5000);
  } catch (e) {
    const msg = `Failed to load ${finalURL}: ${e && e.stack ? e.stack : String(e)}`;
    log('[loadURL error]', msg);
    try { dialog.showErrorBox('Load Error', msg + `\n\nLog: ${LOG_FILE}`); } catch {}
  }

}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildAppMenu());
  return createWindow();
});
