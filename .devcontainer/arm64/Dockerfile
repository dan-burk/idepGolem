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
RUN apt-get update && apt-get install -y \
    build-essential \
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
    cmake \
    git \
    curl \
    jq \
 && rm -rf /var/lib/apt/lists/*

# 3. Install Docker CLI (for spawning sibling MCP containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# 3a. Install docker-wrapper — shadows /usr/bin/docker via /usr/local/bin precedence
# and blocks dangerous flags (--privileged, host namespace sharing, sensitive bind-mounts)
# and subcommands (exec, build, buildx, push, commit) before they reach the socket proxy.
COPY docker-wrapper.sh /usr/local/bin/docker
RUN chmod 755 /usr/local/bin/docker

# 3b. Egress firewall scaffolding. iptables + ipset for the rules; init-firewall.sh
# applies default-deny + hostname allowlist; entrypoint.sh runs it as root then drops
# to shiny. Requires NET_ADMIN capability on the container (set in docker-compose.yml).
RUN apt-get update && apt-get install -y iptables ipset && rm -rf /var/lib/apt/lists/*
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
COPY entrypoint.sh    /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/init-firewall.sh /usr/local/bin/entrypoint.sh

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

# 9. Create shiny user with no sudo, no privileged groups, user-writable npm prefix.
# See amd64 Dockerfile for rationale. Key point: giving shiny sudo would let an agent
# invoke /usr/bin/docker directly and bypass the wrapper at /usr/local/bin/docker.
# For runtime debugging as root, use `docker exec -u root ...` from the host.
RUN useradd -m -s /bin/bash shiny && \
    mkdir -p /home/shiny/.npm-global && \
    chown -R shiny:shiny /home/shiny/.npm-global
ENV NPM_CONFIG_PREFIX=/home/shiny/.npm-global
ENV PATH="/home/shiny/.npm-global/bin:${PATH}"

# Expose Shiny server port
EXPOSE 3838

# Entrypoint applies the egress firewall (root) and drops to shiny for the CMD.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
