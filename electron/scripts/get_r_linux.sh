#!/usr/bin/env bash
set -euo pipefail

# ==================== Logging ====================
# All output goes to both terminal and logfile
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LOGFILE="${SCRIPT_DIR}/get_r_linux_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "${LOGFILE}") 2>&1
echo "Logging to: ${LOGFILE}"

# ==================== Config ====================
VER="${R_VERSION:-4.5.1}"   # override with env R_VERSION=...

# Candidate URLs — match the host Ubuntu version so shared libs are compatible.
# Posit (formerly RStudio) publishes prebuilt R debs per Ubuntu release.
UBUNTU_VER="$(lsb_release -rs 2>/dev/null | tr -d '.')"  # e.g. "2404"
CANDIDATES=(
  "https://cdn.posit.co/r/ubuntu-${UBUNTU_VER}/pkgs/r-${VER}_1_amd64.deb"
  "https://cdn.posit.co/r/ubuntu-2404/pkgs/r-${VER}_1_amd64.deb"
  "https://cdn.posit.co/r/ubuntu-2204/pkgs/r-${VER}_1_amd64.deb"
  "https://cdn.posit.co/r/ubuntu-2004/pkgs/r-${VER}_1_amd64.deb"
)

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

# Fix hardcoded paths in the R wrapper script and config files.
# The Posit deb hardcodes /opt/R/<ver>/lib/R as R_HOME. After extraction,
# RDEST *is* that lib/R directory, so replace the full original R_HOME first,
# then any remaining top-level /opt/R/<ver> references.
sed -i "s|/opt/R/${VER}/lib/R|${RDEST}|g" "${RDEST}/bin/R"
sed -i "s|/opt/R/${VER}|${RDEST}|g"       "${RDEST}/bin/R"

# The Rscript ELF binary has a hardcoded R_HOME baked in at compile time and
# ignores the R_HOME env var, so it cannot work after relocation.  Use the
# shell wrapper (bin/R) instead — the sed above already patched its paths.
RSCRIPT="${RDEST}/bin/R --no-echo --no-restore"

# Replace the broken Rscript binary with a shell wrapper so that configure
# scripts (e.g. rhdf5filters) that call Rscript also work.
mv "${RDEST}/bin/Rscript" "${RDEST}/bin/Rscript.orig"
cat > "${RDEST}/bin/Rscript" <<'WRAPPER'
#!/bin/sh
exec "$(dirname "$0")/R" --no-echo --no-restore "$@"
WRAPPER
chmod +x "${RDEST}/bin/Rscript"

echo "R version:"
${RSCRIPT} -e 'cat(R.version.string, "\n")'
echo "✅ Linux R runtime ready at: ${RDEST}"

# ==================== System Dependencies ====================
echo ""
echo "==================== Installing system build dependencies ===================="

sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  build-essential cmake gfortran libcurl4-openssl-dev libssl-dev libxml2-dev \
  libfontconfig1-dev libharfbuzz-dev libfribidi-dev libfreetype6-dev \
  libpng-dev libtiff5-dev libjpeg-dev libgit2-dev libsodium-dev \
  libcairo2-dev libglpk-dev libmagick++-6.q16-dev libproj-dev \
  libhdf5-dev libblosc-dev

# ==================== Install R Packages ====================
echo ""
echo "==================== Installing R packages via PPM snapshot ===================="

LIB="${RDEST}/library"

# Ubuntu puts HDF5 headers in /usr/include/hdf5/serial/ instead of the
# standard /usr/include/.  rhdf5filters needs this to find H5PLextern.h.
export C_INCLUDE_PATH="/usr/include/hdf5/serial${C_INCLUDE_PATH:+:$C_INCLUDE_PATH}"
export CPATH="/usr/include/hdf5/serial${CPATH:+:$CPATH}"
export LIBRARY_PATH="/usr/lib/x86_64-linux-gnu/hdf5/serial${LIBRARY_PATH:+:$LIBRARY_PATH}"

echo "Library  : ${LIB}"
echo ""

${RSCRIPT} --no-save --file="${SCRIPT_DIR}/install_packages.R" --args "${LIB}"

echo "✅ R packages installed"
