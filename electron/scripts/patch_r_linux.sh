#!/usr/bin/env bash
set -euo pipefail
# patch_r_linux.sh — Make a relocated Posit R runtime portable.
#
# The Posit .deb hardcodes /opt/R/<ver>/lib/R into bin/R and bakes
# R_HOME into the Rscript ELF binary at compile time.  After
# electron-builder packages the app the install path is completely
# different, so both must be patched.
#
# Usage:  patch_r_linux.sh <R_HOME_DIR>
#   e.g.  patch_r_linux.sh electron/runtime/R.linux

dst="${1:?Usage: patch_r_linux.sh <R_HOME_DIR>}"

if [ ! -f "${dst}/bin/R" ]; then
  echo "ERROR: ${dst}/bin/R not found — is this an R home directory?" >&2
  exit 1
fi

# ── 1. Make bin/R self-referencing ────────────────────────────────
# R_HOME_DIR (and friends) are hardcoded to the original install
# prefix.  Replace them with values computed from the script's own
# location so they resolve correctly wherever the app is installed.
# bin/R lives at <R_HOME>/bin/R, so dirname/.. = R_HOME.
sed -i 's|^R_HOME_DIR=.*|R_HOME_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." \&\& pwd)"|' "${dst}/bin/R"
sed -i 's|^R_SHARE_DIR=.*|R_SHARE_DIR=${R_HOME_DIR}/share|'       "${dst}/bin/R"
sed -i 's|^R_INCLUDE_DIR=.*|R_INCLUDE_DIR=${R_HOME_DIR}/include|'  "${dst}/bin/R"
sed -i 's|^R_DOC_DIR=.*|R_DOC_DIR=${R_HOME_DIR}/doc|'              "${dst}/bin/R"
echo "Patched bin/R path variables to be self-referencing"

# ── 2. Replace Rscript ELF with a bash wrapper ───────────────────
# The compiled Rscript binary has R_HOME baked in and cannot be
# relocated.  Replace it with a wrapper that translates Rscript-style
# invocations (positional file arg) into R --file= form.
mv "${dst}/bin/Rscript" "${dst}/bin/Rscript.orig"
cat > "${dst}/bin/Rscript" << 'WRAPPER'
#!/bin/bash
# Drop-in Rscript replacement for a relocated R runtime.
# Translates:  Rscript [opts] [-e expr] [file [args]]
# Into:        R --no-echo --no-restore --no-save [opts] [--file=file] [--args ...]
DIR="$(dirname "$(readlink -f "$0")")"
r_args=(--no-echo --no-restore --no-save)
file=""; script_args=(); skip_next=false
for arg in "$@"; do
  if $skip_next; then r_args+=("$arg"); skip_next=false
  elif [ -n "$file" ]; then script_args+=("$arg")
  elif [ "$arg" = "-e" ]; then r_args+=(-e); skip_next=true
  elif [[ "$arg" == -* ]]; then r_args+=("$arg")
  else file="$arg"; fi
done
[ -n "$file" ] && r_args+=(--file="$file")
[ ${#script_args[@]} -gt 0 ] && r_args+=(--args "${script_args[@]}")
exec "$DIR/R" "${r_args[@]}"
WRAPPER
chmod +x "${dst}/bin/Rscript"
echo "Replaced bin/Rscript ELF with bash wrapper"
