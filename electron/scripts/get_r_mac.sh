#!/usr/bin/env bash
set -euo pipefail

# ==================== Config ====================
VER="${R_VERSION:-4.5.1}"   # override with env R_VERSION=...
# Auto-detect ARCH unless overridden via R_ARCH
if [[ -z "${R_ARCH:-}" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="x86_64" ;;
    *)             ARCH="x86_64" ;;
  esac
else
  ARCH="${R_ARCH}"
fi

# Candidate URLs (primary + fallbacks)
CANDIDATES=(
  "https://cran.r-project.org/bin/macosx/big-sur-${ARCH}/base/R-${VER}-${ARCH}.pkg"
  "https://cloud.r-project.org/bin/macosx/big-sur-${ARCH}/base/R-${VER}-${ARCH}.pkg"
  # Intel builds are sometimes published without the -x86_64 suffix
  "https://cran.r-project.org/bin/macosx/big-sur-x86_64/base/R-${VER}.pkg"
  "https://cloud.r-project.org/bin/macosx/big-sur-x86_64/base/R-${VER}.pkg"
)

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ELECTRON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Stage R.framework at the production layout — matches main.js getRuntime()
# (path.join(rp, 'runtime', 'R.framework')) and build-electron-mac.yml.
RFRAMEWORK_DEST="${ELECTRON_DIR}/runtime/R.framework"

TMP="$(mktemp -d)"
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT

PKG_PATH=""
for URL in "${CANDIDATES[@]}"; do
  echo "Trying ${URL} ..."
  if curl -fL --retry 3 --connect-timeout 20 -o "${TMP}/R.pkg" "${URL}"; then
    PKG_PATH="${TMP}/R.pkg"
    echo "Downloaded: ${URL}"
    break
  fi
done

if [[ -z "${PKG_PATH}" ]]; then
  echo "ERROR: Unable to download R ${VER} pkg for macOS (tried ${#CANDIDATES[@]} URLs)." >&2
  exit 1
fi

echo "Expanding pkg ..."
pkgutil --expand-full "${PKG_PATH}" "${TMP}/expanded"

# Locate R.framework inside expanded pkg
RFW="$(/usr/bin/find "${TMP}/expanded" -type d -name 'R.framework' -print -quit || true)"
if [[ -z "${RFW}" ]]; then
  echo "ERROR: R.framework not found in expanded package:" >&2
  /usr/bin/find "${TMP}/expanded" -maxdepth 4 -print
  exit 1
fi

echo "Copying R.framework to ${RFRAMEWORK_DEST} ..."
rm -rf "${RFRAMEWORK_DEST}"
mkdir -p "$(dirname "${RFRAMEWORK_DEST}")"
ditto "${RFW}" "${RFRAMEWORK_DEST}"

echo "Rscript version:"
"${RFRAMEWORK_DEST}/Resources/bin/Rscript" --version
echo "✅ macOS R runtime ready at: ${RFRAMEWORK_DEST}"

# ==================== Install dev-light R packages ====================
# Just shiny + golem + idepGolemDev — enough to run the diagnostic Shiny app.
# Production (build-electron-mac.yml) uses install_packages.R for the
# full ~355-package runtime; this dev script deliberately does not.
echo ""
echo "==================== Installing dev-light packages (shiny + golem + idepGolemDev) ===================="

RSCRIPT="${RFRAMEWORK_DEST}/Resources/bin/Rscript"
RBIN="${RFRAMEWORK_DEST}/Resources/bin/R"
LIB="${RFRAMEWORK_DEST}/Resources/library"
DEV_PKG="${ELECTRON_DIR}/idepGolemDev"

echo "Library      : ${LIB}"
echo "idepGolemDev : ${DEV_PKG}"
echo ""

${RSCRIPT} -e "install.packages(c('shiny','golem'), lib='${LIB}', repos='https://cloud.r-project.org')"

"${RBIN}" CMD INSTALL --library="${LIB}" "${DEV_PKG}"

echo "✅ dev-light packages installed (shiny + golem + idepGolemDev)"
