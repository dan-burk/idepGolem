# Electron Platform Build: Linux Distribution

## What GitHub Actions Produces

The workflow (`.github/workflows/build-electron-linux.yml`) uses `electron-builder` to create a full Linux distribution. The `actions/upload-artifact` step uploads everything in `dist/**` as a zip called `linux-dist`. GitHub Actions always zips artifacts — there's no way around this.

## Contents of linux-dist.zip

| File / Folder | Size | Purpose |
|---|---|---|
| `idep-1.0.0-linux-amd64.deb` | ~1.9G | Debian/Ubuntu installer package |
| `idep-1.0.0-linux-x86_64.AppImage` | ~1.5G | Portable Linux executable (any distro) |
| `linux-unpacked/` | ~9.4G | Unpackaged app (all files loose) |
| `builder-debug.yml` | 4K | Build debug log (not needed) |
| `latest-linux.yml` | 4K | Auto-update manifest (not needed for manual distribution) |

**You only need ONE of the three distribution formats.** The `.deb`, `.AppImage`, and `linux-unpacked/` each contain the complete app. The `.deb` and `.AppImage` are just packaged versions of what's in `linux-unpacked/`.

## What's Inside Each Distribution

### Electron runtime (~240MB)
- `idepgolem` binary (the Electron/Chromium executable)
- `.pak` files, `icudtl.dat`, `.so` libraries, `snapshot_blob.bin`, `v8_context_snapshot.bin`
- `locales/` directory
- All required for Chromium/Electron to function

### App code (`resources/app/`, ~4.6G)
- `main.js` — Electron main process entry point
- `app/` — R/Shiny app source (R/, app.R, DESCRIPTION)
- `node_modules/` — Node.js dependencies
- `package.json`

### R runtime (`resources/runtime/`, ~4.6G)
- `R.linux/` — Complete R installation with all 355+ packages
- Includes Bioconductor, CRAN, and GitHub packages

## Which Format to Distribute

| Format | Best for | Install method |
|---|---|---|
| `.deb` | Ubuntu/Debian users | `sudo dpkg -i idep-1.0.0-linux-amd64.deb` |
| `.AppImage` | Any Linux distro | `chmod +x idep-*.AppImage && ./idep-*.AppImage` |
| `linux-unpacked/` | Development/debugging | Run `./idepgolem` directly |

### Recommendation

- For a single download link: use the **`.AppImage`** (most portable, no install needed)
- For Debian/Ubuntu users: use the **`.deb`** (integrates with system package manager)
- To reduce the GitHub Actions artifact size, configure electron-builder to only produce the format(s) you need:

```json
"linux": {
  "target": ["deb"]
}
```

This would cut the artifact from ~12.5G to ~2G.

## Files NOT Needed for Distribution

- `builder-debug.yml` — electron-builder debug output
- `latest-linux.yml` — only needed if using electron-builder's auto-update feature
- `linux-unpacked/` — only needed if you want users to run without installing
