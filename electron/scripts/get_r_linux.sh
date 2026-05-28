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

# Stage R at the production layout — matches main.js getRuntime()
# (path.join(rp, 'runtime', 'R.linux')) and build-electron-linux.yml.
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RDEST="${ELECTRON_DIR}/runtime/R.linux"

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
mkdir -p "$(dirname "${RDEST}")"
cp -a "${RHOME}" "${RDEST}"

# Fix hardcoded paths and replace Rscript ELF with a portable wrapper.
bash "$(dirname "$0")/patch_r_linux.sh" "${RDEST}"

RSCRIPT="${RDEST}/bin/Rscript"

echo "R version:"
${RSCRIPT} -e 'cat(R.version.string, "\n")'
echo "✅ Linux R runtime ready at: ${RDEST}"

# ==================== System Dependencies (dev-light) ====================
# Minimal build deps for shiny + golem only. Production CI installs a
# much larger set for the full Bioconductor stack.
echo ""
echo "==================== Installing system build dependencies (dev-light) ===================="

sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  build-essential libcurl4-openssl-dev libssl-dev

# ==================== Install dev-light R packages ====================
# Just shiny + golem + idepGolemDev — enough to run the diagnostic Shiny app.
# Production (build-electron-linux.yml) uses install_packages.R for the
# full ~355-package runtime; this dev script deliberately does not.
echo ""
echo "==================== Installing dev-light packages (shiny + golem + idepGolemDev) ===================="

LIB="${RDEST}/library"
DEV_PKG="${ELECTRON_DIR}/idepGolemDev"

echo "Library      : ${LIB}"
echo "idepGolemDev : ${DEV_PKG}"
echo ""

# Suppress the developer's user library (default ~/R/x86_64-pc-linux-gnu-library/...)
# so install.packages doesn't skip transitives it considers "already installed"
# there — which would leave the bundled runtime missing rlang/cli/glue/etc. at
# app launch. R treats the literal string "NULL" as "no user library".
# --vanilla alone is not enough because R sets the default R_LIBS_USER path
# even when .Renviron is suppressed.
R_LIBS_USER=NULL ${RSCRIPT} --vanilla -e "install.packages(c('shiny','golem'), lib='${LIB}', repos='https://cloud.r-project.org')"

R_LIBS_USER=NULL "${RDEST}/bin/R" --vanilla CMD INSTALL --library="${LIB}" "${DEV_PKG}"

echo "✅ dev-light packages installed (shiny + golem + idepGolemDev)"
