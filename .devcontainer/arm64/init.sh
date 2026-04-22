#!/bin/bash
# Host-side initialization, run via initializeCommand before docker-compose up.
# Validates prerequisites and writes a .env file for compose variable expansion.
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
CREDS="$CLAUDE_DIR/.credentials.json"
PROJECT_PATH="$(pwd)"

# Ensure ~/.claude/ exists on host (first-run convenience).
if [ ! -d "$CLAUDE_DIR" ]; then
    mkdir -p "$CLAUDE_DIR"
    echo "Created $CLAUDE_DIR"
fi

# Require a valid credential file on host. Claude Code inside the container can't
# complete an OAuth browser flow, so host auth must happen first.
if [ ! -f "$CREDS" ]; then
    echo "ERROR: $CREDS not found." >&2
    echo "Run 'claude' on the host to authenticate (or 'claude setup-token'), then retry." >&2
    exit 1
fi

# Per-project memory/history directory. Claude Code encodes the absolute project path
# as the dir name by replacing '/' with '-'. Precreate on host so Docker doesn't
# silently create a root-owned empty dir at the bind-mount source on first run.
HOST_PROJECT_HASH=$(echo "$PROJECT_PATH" | tr '/' '-')
HOST_PROJECT_DIR="$CLAUDE_DIR/projects/$HOST_PROJECT_HASH"
mkdir -p "$HOST_PROJECT_DIR"

# Compose project name for arch-based isolation.
PROJECT_NAME=$(basename "$PROJECT_PATH" | tr '[:upper:]' '[:lower:]')

# Project basename used for the container workspace path (/workspaces/<basename>).
PROJECT_BASENAME=$(basename "$PROJECT_PATH")

# Write compose env file. Variables referenced by docker-compose.yml:
#   CLAUDE_PROJECT_HOST — per-project memory mount source
#   HOST_PROJECT_PATH   — host path of the project, used for the .devcontainer RO overlay
#   PROJECT_BASENAME    — last path component, used for the container-side mount target
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
cat > "$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=${PROJECT_NAME}-arm64
CLAUDE_PROJECT_HOST=${HOST_PROJECT_DIR}
HOST_PROJECT_PATH=${PROJECT_PATH}
PROJECT_BASENAME=${PROJECT_BASENAME}
EOF

echo "Wrote $ENV_FILE"
echo "  COMPOSE_PROJECT_NAME=${PROJECT_NAME}-arm64"
echo "  CLAUDE_PROJECT_HOST=${HOST_PROJECT_DIR}"
echo "  HOST_PROJECT_PATH=${PROJECT_PATH}"
echo "  PROJECT_BASENAME=${PROJECT_BASENAME}"
