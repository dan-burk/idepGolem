#!/bin/bash
# Container entrypoint. Runs as root. In order:
#   1. Apply iptables egress firewall
#   2. Stage OAuth credentials + per-project memory into shiny's writable home
#      (root does the copy so perms/ownership are tight before shiny ever sees them)
#   3. Drop privileges and exec the CMD as shiny
#
# VS Code `docker exec` sessions bypass this entrypoint but inherit everything it
# applied (iptables rules live in the netns; ~/.claude/ contents are already staged).
set -euo pipefail

/usr/local/bin/init-firewall.sh

SHINY_HOME=/home/shiny
SHINY_UID=$(id -u shiny)
SHINY_GID=$(id -g shiny)

mkdir -p "$SHINY_HOME/.claude/projects"

# Credentials: copy, lock down perms, transfer ownership to shiny.
if [ -f /mnt/claude-credentials ]; then
    cp /mnt/claude-credentials "$SHINY_HOME/.claude/.credentials.json"
    chmod 600 "$SHINY_HOME/.claude/.credentials.json"
    chown "$SHINY_UID:$SHINY_GID" "$SHINY_HOME/.claude/.credentials.json"
fi

# Per-project memory: the container workspace path differs from the host path, so
# Claude Code in the container computes a different project hash. Re-stage under
# the container-side hash so memory is discoverable from inside.
if [ -d /mnt/claude-project ]; then
    WORKSPACE=$(ls -d /workspaces/*/ 2>/dev/null | head -n1 | sed 's:/*$::')
    if [ -n "$WORKSPACE" ]; then
        CONTAINER_HASH=$(echo "$WORKSPACE" | tr '/' '-')
        DEST="$SHINY_HOME/.claude/projects/$CONTAINER_HASH"
        mkdir -p "$DEST"
        cp -r /mnt/claude-project/. "$DEST/" 2>/dev/null || true
    fi
fi

chown -R "$SHINY_UID:$SHINY_GID" "$SHINY_HOME/.claude"

exec runuser -u shiny -- "$@"
