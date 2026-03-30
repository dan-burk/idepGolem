# electron/scripts/get_r_windows.ps1
$ErrorActionPreference = "Stop"

# ==================== Logging ====================
# All output goes to both terminal and logfile
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $scriptDir "get_r_windows_${timestamp}.log"

# Start a transcript so every Write-Host / stdout / stderr line is captured
Start-Transcript -Path $logFile -Append
Write-Host "Logging to: $logFile"

# -------- Config --------
$Rver = $env:R_VERSION
if (-not $Rver -or $Rver -eq "") { $Rver = "4.5.1" }   # default version

Write-Host "Using R version: $Rver"

# runtime destination (flat layout)
# script is run from electron/scripts so ../runtime/win/R is the target
$repoRoot = Resolve-Path ".." | Select-Object -ExpandProperty Path
$destWin  = Join-Path $repoRoot "runtime\win"
$destR    = Join-Path $destWin  "R"
New-Item -ItemType Directory -Force -Path $destWin | Out-Null

# Temp working dir
$tmp = Join-Path $env:TEMP ("rwin_" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  # -------- Download installer --------
  $exe = Join-Path $tmp "R-$Rver-win.exe"
  $urls = @(
    "https://cloud.r-project.org/bin/windows/base/old/$Rver/R-$Rver-win.exe",
    "https://cran.r-project.org/bin/windows/base/old/$Rver/R-$Rver-win.exe",
    "https://cloud.r-project.org/bin/windows/base/R-$Rver-win.exe",
    "https://cran.r-project.org/bin/windows/base/R-$Rver-win.exe"
  )

  $downloaded = $false
  foreach ($u in $urls) {
    Write-Host "Trying $u ..."
    try {
      Invoke-WebRequest -Uri $u -OutFile $exe -UseBasicParsing
      if ((Get-Item $exe).Length -gt 0) { $downloaded = $true; Write-Host "Downloaded $u"; break }
    } catch { Write-Host "Download failed from $u, trying next mirror..." }
  }
  if (-not $downloaded) { throw "Failed to download R-$Rver Windows installer from all candidates." }

  # -------- Install silently into temp base (installer creates R-x.y.z under here) --------
  $installBase = Join-Path $tmp "R-install"
  New-Item -ItemType Directory -Force -Path $installBase | Out-Null

  Write-Host "Installing R silently into $installBase ..."
  & $exe /VERYSILENT /DIR="$installBase" /NORESTART /SP- /SUPPRESSMSGBOXES | Out-Null

  # -------- Locate the versioned R home (R-x.y.z) --------
  # Prefer by discovering Rscript.exe, then take its parent twice to get R-x.y.z
  $rscript = Get-ChildItem -Recurse -Path $installBase -Filter Rscript.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $rscript) { throw "Rscript.exe not found under $installBase after install." }

  $rHome = $rscript.Directory.Parent  # ...\R-x.y.z
  if (-not (Test-Path (Join-Path $rHome.FullName "bin\R.exe"))) {
    throw "R.exe not found in $(Join-Path $rHome.FullName 'bin'); unexpected layout."
  }

  Write-Host "Detected R home: $($rHome.FullName)"

  # -------- Normalize to flat layout: ../runtime/win/R/{bin,library,...} --------
  if (Test-Path $destR) {
    Write-Host "Cleaning existing $destR ..."
    Remove-Item -Recurse -Force $destR
  }
  New-Item -ItemType Directory -Force -Path $destR | Out-Null

  # Copy CONTENTS of R-x.y.z into ../runtime/win/R (so we get R/bin, not R/R-x.y.z/bin)
  Write-Host "Copying portable R to $destR ..."
  Copy-Item -Recurse -Force -Path (Join-Path $rHome.FullName "*") -Destination $destR

  # -------- Sanity checks --------
  $destRscript = Join-Path $destR "bin\Rscript.exe"
  if (-not (Test-Path $destRscript)) { throw "Missing $destRscript after copy." }
  $destRexe = Join-Path $destR "bin\R.exe"
  if (-not (Test-Path $destRexe)) { throw "Missing $destRexe after copy." }
  $destRdll = Join-Path $destR "bin\x64\R.dll"
  if (-not (Test-Path $destRdll)) { Write-Host "Warning: $destRdll not found (some builds place R.dll under bin only)"; }

  Write-Host "Rscript located at: $destRscript"
  & $destRscript --version 2>&1 | Write-Host

  Write-Host "✅ Windows R runtime ready under $destR"

  # ==================== Install R Packages ====================
  Write-Host ""
  Write-Host "==================== Installing R packages via renv ===================="

  $projRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
  $lockfile = Join-Path $projRoot "renv.lock"
  if (-not (Test-Path $lockfile)) { throw "renv.lock not found at $lockfile" }

  $lib = Join-Path $destR "library"

  Write-Host "Lockfile : $lockfile"
  Write-Host "Library  : $lib"
  Write-Host ""

  # Install renv into the staged R
  Write-Host "Installing renv ..."
  & $destRscript -e "install.packages('renv', repos = 'https://cloud.r-project.org', quiet = TRUE)" 2>&1 | Write-Host

  # Install BiocManager (renv needs it to resolve Bioconductor packages)
  Write-Host "Installing BiocManager ..."
  & $destRscript -e "install.packages('BiocManager', repos = 'https://cloud.r-project.org', quiet = TRUE)" 2>&1 | Write-Host

  # Restore all packages from lockfile into the staged library
  # Use forward slashes in paths for R compatibility
  $lockfileR = $lockfile -replace '\\', '/'
  $libR = $lib -replace '\\', '/'

  # renv 1.2.0 bug (rstudio/renv#2249): when DESCRIPTION fetch fails for
  # non-repository packages (URL, GitHub), renv copies lockfile fields
  # (JSON arrays) into desc as-is.  renv_description_parse_field() then
  # crashes on is.na(vector).  We patch it to collapse vectors to strings
  # before the original logic runs.  The return type (data_frame) is unchanged.
  # Write R restore script to a temp file (PowerShell here-strings passed
  # via -e don't work reliably with Rscript on Windows)
  $restoreScript = Join-Path $tmp "renv_restore.R"
  Set-Content -Path $restoreScript -Value @"
options(warn = 1)

# Posit Package Manager (in renv.lock) only serves Linux binaries.
# Override renv's lockfile repos with mirrors that serve Windows binaries.
options(renv.config.repos.override = c(
  CRAN    = 'https://cloud.r-project.org',
  BioCsoft = 'https://bioconductor.org/packages/3.21/bioc',
  BioCann  = 'https://bioconductor.org/packages/3.21/data/annotation',
  BioCexp  = 'https://bioconductor.org/packages/3.21/data/experiment'
))

# renv 1.2.0 bug (rstudio/renv#2249): when DESCRIPTION fetch fails for
# non-repository packages (URL, GitHub), renv copies lockfile fields
# (JSON arrays) into desc as-is.  renv_description_parse_field() then
# crashes on is.na(vector).  We patch it to collapse vectors to strings
# before the original logic runs.  The return type (data_frame) is unchanged.
orig <- get('renv_description_parse_field', envir = asNamespace('renv'))

patched <- function(field) {
  if (length(field) > 1L)
    field <- paste(unlist(field), collapse = ', ')
  orig(field)
}
environment(patched) <- environment(orig)
utils::assignInNamespace('renv_description_parse_field', patched, ns = 'renv')

renv::restore(
  lockfile = '$lockfileR',
  library  = '$libR',
  prompt   = FALSE
)
"@

  Write-Host "Running renv::restore() - this will take a while ..."
  & $destRscript --no-save --no-restore $restoreScript 2>&1 | Write-Host

  Write-Host ""
  $pkgCount = (Get-ChildItem -Directory -Path $lib).Count
  Write-Host "$pkgCount packages installed in $lib"
  Write-Host "✅ R packages installed"
}
finally {
  if (Test-Path $tmp) {
    Write-Host "Cleaning up temp dir $tmp ..."
    Remove-Item -Recurse -Force $tmp
  }
  Stop-Transcript
}
