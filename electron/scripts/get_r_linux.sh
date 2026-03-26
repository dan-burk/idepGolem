#!/usr/bin/env bash
set -euo pipefail

# ==================== Config ====================
VER="${R_VERSION:-4.5.1}"   # override with env R_VERSION=...

# Candidate URLs (primary + fallbacks)
# Posit (formerly RStudio) publishes prebuilt R tarballs for Ubuntu
CANDIDATES=(
  "https://cdn.posit.co/r/ubuntu-2204/pkgs/r-${VER}_1_amd64.deb"
  "https://cdn.posit.co/r/ubuntu-2004/pkgs/r-${VER}_1_amd64.deb"
)

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OUTDIR="${SCRIPT_DIR}/r-linux"
RDEST="${OUTDIR}/R"   # <--- this is what build-electron.yml expects

TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

DEB_PATH=""
for URL in "${CANDIDATES[@]}"; do
  echo "Trying ${URL} ..."
  if curl -fL --retry 3 --connect-timeout 20 -o "${TMP}/R.deb" "${URL}"; then
    DEB_PATH="${TMP}/R.deb"
    echo "Downloaded: ${URL}"
    break
  fi
done

if [[ -z "${DEB_PATH}" ]]; then
  echo "ERROR: Unable to download R ${VER} deb for Linux (tried ${#CANDIDATES[@]} URLs)." >&2
  exit 1
fi

echo "Extracting deb ..."
dpkg-deb -x "${DEB_PATH}" "${TMP}/extracted"

# Locate the R home inside the extracted deb (typically /opt/R/x.y.z)
RHOME="$(find "${TMP}/extracted" -type f -name 'Rscript' -path '*/bin/Rscript' -print -quit || true)"
if [[ -z "${RHOME}" ]]; then
  echo "ERROR: Rscript not found in extracted deb:" >&2
  find "${TMP}/extracted" -maxdepth 4 -print
  exit 1
fi
RHOME="$(dirname "$(dirname "${RHOME}")")"   # strip bin/Rscript -> R home

echo "Copying R runtime to ${RDEST} ..."
rm -rf "${RDEST}"
mkdir -p "${OUTDIR}"
cp -a "${RHOME}" "${RDEST}"

echo "Rscript version:"
"${RDEST}/bin/Rscript" --version
echo "✅ Linux R runtime ready at: ${RDEST}"
