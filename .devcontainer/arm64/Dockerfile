# Use native multi-arch image (works on ARM64 and AMD64)
# Note: rocker/shiny-verse has limited ARM64 support because Shiny Server
# doesn't distribute ARM64 binaries. Use rocker/r-ver instead.
FROM rocker/r-ver:4.5.1

# 1. Configure Posit Package Manager for CRAN + Bioconductor (prebuilt binaries)
# BioC_mirror + BIOCONDUCTOR_CONFIG_FILE let BiocManager resolve sub-repos from PPM
# This serves prebuilt Linux binaries for both CRAN and Bioconductor packages
RUN echo 'options(BioC_mirror = "https://packagemanager.posit.co/bioconductor/latest", BIOCONDUCTOR_CONFIG_FILE = "https://packagemanager.posit.co/bioconductor/latest/config.yaml", repos = c(CRAN = "https://packagemanager.posit.co/cran/__linux__/noble/latest"))' >> /usr/local/lib/R/etc/Rprofile.site && \
    echo 'Sys.setenv("R_BIOC_VERSION" = "3.21")' >> /usr/local/lib/R/etc/Rprofile.site

# 2. System deps (still needed for some packages that compile from source)
# libhdf5-dev/libblosc-dev/gfortran are required by rhdf5filters and other iDEP
# bioinformatics dependencies — matches electron/scripts/get_r_linux.sh.
RUN apt-get update && apt-get install -y \
    build-essential \
    gfortran \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    libgit2-dev \
    libsodium-dev \
    libcairo2-dev \
    libglpk-dev \
    libmagick++-6.q16-dev \
    libproj-dev \
    libhdf5-dev \
    libblosc-dev \
    cmake \
    git \
    curl \
    jq \
 && rm -rf /var/lib/apt/lists/*

# Ubuntu puts HDF5 headers under /usr/include/hdf5/serial/ rather than /usr/include/,
# so rhdf5filters (and friends) need these paths to find H5PLextern.h at compile time.
ENV C_INCLUDE_PATH=/usr/include/hdf5/serial \
    CPATH=/usr/include/hdf5/serial \
    LIBRARY_PATH=/usr/lib/aarch64-linux-gnu/hdf5/serial

# 3. Install Docker CLI (for spawning sibling MCP containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# 4. Install all R packages needed for analysis, IDE integration, and MCP
# Note: dependencies=NA skips optional "Suggests" (e.g., otelsdk) for faster builds
RUN R -e "options(warn = 2); install.packages(c('tidyverse', 'shiny', 'readxl', 'fst', 'jsonlite', 'plotly', 'randomForest', 'nnet', 'caret', 'pROC', 'dbscan', 'umap', 'igraph', 'networkD3', 'fastDummies', 'smotefamily', 'rstudioapi', 'languageserver', 'btw', 'ellmer', 'mcptools', 'Rprofet', 'renv'), dependencies = NA)"

# 7. Install Node.js LTS from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# 8. AI CLI tools (claude-code, codex, gemini) installed at container creation
# via onCreateCommand in devcontainer.json — keeps the image stable and avoids
# rebuilds when these frequently-updated tools release new versions.

# 9. Give shiny passwordless sudo for updating Claude Code from VS Code
RUN useradd -m -s /bin/bash shiny && \
    echo 'shiny ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    usermod -aG root shiny && \
    usermod -aG staff shiny && \
    rm -rf /var/lib/apt/lists/*

# Expose Shiny server port
EXPOSE 3838
