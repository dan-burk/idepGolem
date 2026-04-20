// main.js
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
// Node 22+ (bundled in Electron 39) provides global fetch natively

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
    const roots = [
      path.join(rp, 'runtime', 'R.win'),
      path.join(rp, 'R.win'),
      path.join(rp, 'resources', 'R.win'),
      path.join(rp, 'runtime', 'R-Portable'),
      path.join(rp, 'R-Portable'),
    ];
    const R_ROOT = roots.find(fs.existsSync);
    const binDir = R_ROOT ? path.join(R_ROOT, 'bin') : null;
    const candidates = [
      binDir && path.join(binDir, 'Rscript.exe'),
      R_ROOT && path.join(R_ROOT, 'bin', 'x64', 'Rscript.exe'),
    ].filter(Boolean);
    const rscript = candidates.find(p => fs.existsSync(p));
    if (!R_ROOT || !rscript) {
      const msg = `Could not locate bundled Rscript.exe.\nresourcesPath: ${rp}\nChecked:\n${roots.join('\n')}\n`;
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
        R_LIBS: libDir,
        R_LIBS_USER: libDir,
        R_LIBS_SITE: '',
        R_USER: R_ROOT,
        PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(';'),
      },
    };
  }

  if (process.platform === 'darwin') {
    const candidates = [
      path.join(rp, 'runtime', 'R.framework', 'Resources', 'bin', 'Rscript'),
      path.join(rp, 'R.framework', 'Resources', 'bin', 'Rscript'),
      path.join(rp, 'resources', 'R.framework', 'Resources', 'bin', 'Rscript'),
    ];
    const rscript = candidates.find(fs.existsSync);
    if (!rscript) {
      log('[macOS] Rscript not found. Checked:\n' + candidates.join('\n'));
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
  const roots = [
    path.join(rp, 'runtime', 'R.linux'),
    path.join(rp, 'R.linux'),
    path.join(rp, 'resources', 'R.linux'),
  ];
  const R_ROOT = roots.find(fs.existsSync);
  const binDir = R_ROOT ? path.join(R_ROOT, 'bin') : null;
const rscript = (binDir && fs.existsSync(path.join(binDir, 'Rscript')))
  ? path.join(binDir, 'Rscript')
  : 'Rscript';
  return {
    rscript,
    env: R_ROOT ? {
      R_HOME: R_ROOT,
      LD_LIBRARY_PATH: [path.join(R_ROOT, 'lib'), process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':'),
      PATH: [binDir, process.env.PATH || ''].filter(Boolean).join(':'),
    } : {},
  };
}

function isWritableDir(p) {
  try { fs.accessSync(p, fs.constants.W_OK); return fs.statSync(p).isDirectory(); } catch { return false; }
}
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

function showPlaceholder() {
  if (global.win) return;
  global.win = new BrowserWindow({
    width: 900,
    height: 500,
    show: true,
    resizable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const splashPath = path.join(__dirname, 'splash.html');
  const html = fs.readFileSync(splashPath, 'utf8')
    .replace('{{LOG_FILE}}', LOG_FILE.replace(/\\/g, '/'));

  global.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
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
  setSplashProgress(0.1, 'Preparing data directory…');

  // demo data directory under app
  const DEMO_DIR = path.join(APP_DIR, 'data113');
  let demoDirExists = false;
  try {
    demoDirExists = fs.existsSync(DEMO_DIR) && fs.readdirSync(DEMO_DIR).length > 0;
  } catch {}
  log('[demo data]', 'DEMO_DIR =', DEMO_DIR, 'exists =', demoDirExists);

  // data dir
  const LAUNCH_DIR = process.cwd();
  const overrideDir = process.env.IDEP_DATA_DIR || process.env.IDEP_DATABASE;
  let DATA_PARENT;
  if (overrideDir) DATA_PARENT = path.resolve(overrideDir);
  else if (LAUNCH_DIR && LAUNCH_DIR !== '/' && isWritableDir(LAUNCH_DIR)) DATA_PARENT = path.join(LAUNCH_DIR, 'idep');
  else DATA_PARENT = path.join(app.getPath('userData'), 'idep');
  try { fs.mkdirSync(DATA_PARENT, { recursive: true }); } catch {}

  // sanity
  const appR = path.join(APP_DIR, 'app.R');
  if (!fs.existsSync(appR)) {
    const msg = `Missing app/app.R.\nLooked at: ${appR}\nLog: ${LOG_FILE}`;
    log('[FATAL]', msg);
    try { dialog.showErrorBox('Missing app.R', msg); } catch {}
    app.quit(); return;
  }

  // runtime
  const runtime = getRuntime();
  if (!runtime) { app.quit(); return; }
  const { rscript, env } = runtime;
  setSplashProgress(0.25, 'R runtime located…');

  // OPTIONAL: one-time diagnostics
  try {
    const diag = spawn(rscript, ['-e',
      "cat('LIBPATHS:\\n', paste(.libPaths(), collapse='\\n'), '\\n'); " +
      "cat('ottoPlots available? ', requireNamespace('ottoPlots', quietly=TRUE), '\\n')"
    ], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    diag.stdout.on('data', d => log('[R diag stdout]', String(d).trim()));
    diag.stderr.on('data', d => log('[R diag stderr]', String(d).trim()));
  } catch (e) {
    log('[R diag error]', e && e.stack ? e.stack : String(e));
  }

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
        IDEP_DATABASE: DATA_PARENT,
        IDEP_DATA_DIR: DATA_PARENT,
        IDEP_APP_DIR: APP_DIR,
        IDEP_HOST: host,
        IDEP_PORT: String(port),
        IDEP_DEMO_DIR: DEMO_DIR, // pass demo dir hint to R
        R_LIBS_USER: env?.R_LIBS || path.join(path.dirname(rscript), '..', 'library'),
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

  if (childProc && childProc.stdout) {
    childProc.stdout.on('data', d => log('[R stdout]', String(d).trim()));
  }

  if (childProc && childProc.stderr) {
    childProc.stderr.on('data', d => {
      const text = String(d);
      log('[R stderr]', text.trim());

      const m = text.match(/Listening on http:\/\/[^:]+:(\d+)/);
      if (m) {
        shinyPortFromLog = Number(m[1]);
        log(`[port detect] Shiny reports listening on port ${shinyPortFromLog}`);
      }
    });
  }

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
    await global.win.loadURL(finalURL);
    setSplashProgress(-1, ''); // clear taskbar progress
  } catch (e) {
    const msg = `Failed to load ${finalURL}: ${e && e.stack ? e.stack : String(e)}`;
    log('[loadURL error]', msg);
    try { dialog.showErrorBox('Load Error', msg + `\n\nLog: ${LOG_FILE}`); } catch {}
  }

}

app.whenReady().then(createWindow);
