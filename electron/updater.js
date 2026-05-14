const { app, dialog, shell } = require('electron');

const RELEASES_API = 'https://api.github.com/repos/dan-burk/idepGolem/releases/latest';

function parseVersion(v) {
  const main = String(v).replace(/^v/, '').trim().split(/[-+]/)[0];
  const parts = main.split('.').map(p => parseInt(p, 10));
  if (parts.length === 0 || parts.some(n => !Number.isFinite(n))) return null;
  return parts;
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

async function checkForUpdates(parentWin) {
  if (!app.isPackaged) return;
  if (parentWin && typeof parentWin.isDestroyed === 'function' && parentWin.isDestroyed()) return;

  const current = app.getVersion();

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  let release;
  try {
    const res = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    release = await res.json();
  } finally {
    clearTimeout(to);
  }

  const latest = String(release.tag_name || '').replace(/^v/, '');
  if (!latest || !isNewer(latest, current)) return;

  const detail = String(release.body || '').slice(0, 500);
  const opts = {
    type: 'info',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update available',
    message: `iDEP ${latest} is available (you have ${current}).`,
    detail: detail || undefined,
  };

  const result = parentWin
    ? await dialog.showMessageBox(parentWin, opts)
    : await dialog.showMessageBox(opts);

  if (result.response === 0 && release.html_url) {
    await shell.openExternal(release.html_url);
  }
}

module.exports = { checkForUpdates };
