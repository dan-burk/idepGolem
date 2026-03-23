# Pin to R 4.4.3 (matching ARM64) to prevent cache invalidation on base image updates
FROM rocker/shiny-verse:4.4.3

# 1. Configure Posit Package Manager + Bioconductor repos
# This dramatically speeds up package installation (minutes instead of 30+ min)
RUN echo 'options(repos = c(CRAN = "https://packagemanager.posit.co/cran/__linux__/noble/latest", BioCsoft = "https://bioconductor.org/packages/3.20/bioc", BioCann = "https://bioconductor.org/packages/3.20/data/annotation", BioCexp = "https://bioconductor.org/packages/3.20/data/experiment"))' >> /usr/local/lib/R/etc/Rprofile.site

# 2. System deps commonly needed by R packages (including cmake for nanonext/mcptools)
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
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
    git \
    curl \
    gnupg \
    jq \
 && rm -rf /var/lib/apt/lists/*

# 3. Install Docker CLI (for spawning sibling MCP containers)
# Note: rocker/shiny-verse is Ubuntu-based, so we use the Ubuntu Docker repo
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# 4. Install all R packages needed for analysis, IDE integration, and MCP
# Note: tidyverse and shiny are already in the shiny-verse base image — not listed here
# dependencies=NA skips optional "Suggests" (e.g., otelsdk) for faster builds
RUN R -e "options(warn = 2); install.packages(c('readxl', 'fst', 'jsonlite', 'plotly', 'randomForest', 'nnet', 'caret', 'pROC', 'dbscan', 'umap', 'igraph', 'networkD3', 'fastDummies', 'smotefamily', 'rstudioapi', 'languageserver', 'btw', 'ellmer', 'mcptools', 'Rprofet'), dependencies = NA)"

# 5. Install Node.js LTS from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# 6. AI CLI tools (claude-code, codex, gemini) installed at container creation
# via onCreateCommand in devcontainer.json — keeps the image stable and avoids
# rebuilds when these frequently-updated tools release new versions.

# 7. Give shiny passwordless sudo and Docker socket access
# Add shiny to root group for Docker socket access (socket is typically root:root or root:docker)
RUN echo 'shiny ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    usermod -aG root shiny && \
    usermod -aG staff shiny && \
    rm -rf /var/lib/apt/lists/*

# Expose Shiny server port
EXPOSE 3838
