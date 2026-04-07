# Exit Code 1 Investigation — Linux Electron Build

## Status: In Progress (2026-04-07)

## Symptom

After installing the `.deb` on Linux, the app crashes with exit code 1. Shiny reports "Listening on http://127.0.0.1:PORT" but Electron's `waitForHttp` times out and never gets an HTTP response.

```
[R stderr] Listening on http://127.0.0.1:7778
[port detect] Shiny reports listening on port 7778
Final targetURL = http://127.0.0.1:7778
[waitForHttp] Timeout/Error: Error: Timeout waiting for http://127.0.0.1:7778
```

This happens on both first launch (with data download) and second launch (data already present). The database downloads and extracts successfully to `/home/daniel/idep/data113/`.

## What we know

- R starts fine, packages load, Shiny binds the port
- The `onStart` callback (`init_app` in `run_app.R`) completes before "Listening on" — database download/setup is done
- `waitForHttp` (line 139 in `main.js`) uses `fetch()` but **silently swallows all errors** (`catch {}` on line 148) — we cannot see what fetch is returning or throwing
- `waitForHttp` only accepts HTTP status 200, 404, or 403 (line 147) — if Shiny returns anything else (e.g. 500), it retries silently until timeout
- Timeout was reduced from 120s to 30s in commit `4fd2026` ("who knows if this will fix it")
- The old R-side log (`/home/daniel/idep/electron_r.log`) has a stale error from Apr 2: `FATAL: Could not connect to database: unable to open database file`

## What we ruled out

- **Database missing**: `orgInfo.db` exists at `/home/daniel/idep/data113/demo/orgInfo.db` (8.3MB)
- **Port mismatch**: stderr listener correctly detects the port Shiny binds
- **Double launch**: Log showed doubled lines from accidental double-click, not a code bug
- **Bootstrap fixes already applied**: `setwd(data_dir)`, positional Rscript arg, untar skip logic — all present in current `main.js`

## TODO — Next steps

### 1. Change `waitForHttp` timeout back to 120s (line 573)

```javascript
// Current (too aggressive):
await waitForHttp(finalURL, { timeoutMs: 30000, intervalMs: 500 });

// Change to:
await waitForHttp(finalURL, { timeoutMs: 120000, intervalMs: 500 });
```

Also update the error dialog message from "30s" to "120s".

### 2. Add diagnostic logging to `waitForHttp` (line 148)

The `catch {}` on line 148 needs to log what's actually happening. Replace:

```javascript
} catch {}
```

With something like:

```javascript
} catch (err) {
  if (attempts <= 3 || attempts % 10 === 0) {
    log(`[waitForHttp] attempt ${attempts}: ${err.name}: ${err.message}`);
  }
}
```

Also log the HTTP status when fetch succeeds but the status isn't accepted:

```javascript
if (res.ok || res.status === 404 || res.status === 403) return true;
// Add: log(`[waitForHttp] got status ${res.status}, retrying...`);
```

### 3. Consider accepting any HTTP response as "alive"

If Shiny returns a 500 (server error during UI render), that still proves the server is up. Change the status check to accept any response:

```javascript
// Current — only accepts 200/404/403:
if (res.ok || res.status === 404 || res.status === 403) return true;

// Proposed — any HTTP response means server is alive:
return true;
```

### 4. Test with curl while app is running

Before killing the app on timeout, try from a terminal:

```bash
curl -v http://127.0.0.1:7778
```

This tells us whether the issue is fetch-specific (Electron/Node) or system-wide (firewall, httpuv).

### 5. Rebuild .deb and test

Changes to `electron/main.js` in the git repo don't affect the installed `.deb` at `/opt/iDEP/`. Either:
- Rebuild via GitHub Actions, or
- Edit `/opt/iDEP/resources/app/main.js` directly for quick testing

## Files involved

| File | Role |
|---|---|
| `electron/main.js:139-152` | `waitForHttp` — the silent timeout |
| `electron/main.js:573` | Timeout set to 30s (was 120s) |
| `electron/main.js:147-148` | Status check + silent catch |
| `R/run_app.R` | `init_app` / `onStart` — database setup |
| `R/fct_database.R:24-60` | `connect_convert_db` — download logic |
| `/home/daniel/idep/electron_r.log` | R-side log (stale, from Apr 2) |
| `/tmp/idep-electron.log` | Electron-side log |
