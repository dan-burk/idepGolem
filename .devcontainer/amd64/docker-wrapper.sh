#!/bin/bash
# Filters risky `docker` CLI invocations before they reach the daemon/proxy.
# Complements the tecnativa socket proxy: the proxy restricts which API endpoints
# are exposed; this wrapper restricts flags that the proxy cannot filter (HostConfig
# fields are opaque to URL-path filtering).
# Installed at /usr/local/bin/docker, which resolves before /usr/bin/docker in PATH.

set -euo pipefail

REAL_DOCKER=/usr/bin/docker

deny() {
    echo "docker-wrapper: blocked — $1" >&2
    exit 1
}

[ $# -eq 0 ] && exec "$REAL_DOCKER"

# Block whole subcommands.
# exec/build/buildx/push/commit all have privileged-escalation or buildkit-container
# paths that are hard to filter flag-by-flag. Block outright.
case "$1" in
    exec|build|buildx|push|commit)
        deny "subcommand 'docker $1' disabled"
        ;;
esac

# For run/create, scan every arg for dangerous flags.
if [ "$1" = "run" ] || [ "$1" = "create" ]; then
    prev=""
    for arg in "$@"; do
        # --flag=value forms
        case "$arg" in
            --privileged|--privileged=true)
                deny "$arg" ;;
            --network=host|--net=host|--pid=host|--ipc=host|--userns=host|--uts=host)
                deny "$arg (host namespace)" ;;
            --cap-add=*)
                deny "$arg (capability escalation)" ;;
            --security-opt=*unconfined*)
                deny "$arg (unconfined security profile)" ;;
            --volume=/:*|--volume=/etc*|--volume=/root*|--volume=/home*|--volume=/var/run/docker.sock*)
                deny "$arg (sensitive host path)" ;;
            -v=/:*|-v=/etc*|-v=/root*|-v=/home*|-v=/var/run/docker.sock*)
                deny "$arg (sensitive host path)" ;;
        esac
        # --flag value forms (check against previous arg)
        case "$prev" in
            --network|--net|--pid|--ipc|--userns|--uts)
                [ "$arg" = "host" ] && deny "$prev host (host namespace)" ;;
            --cap-add)
                deny "$prev $arg (capability escalation)" ;;
            --security-opt)
                case "$arg" in *unconfined*) deny "$prev $arg (unconfined security profile)" ;; esac ;;
            -v|--volume)
                case "$arg" in
                    /:*|/etc*|/root*|/home*|/var/run/docker.sock*)
                        deny "$prev $arg (sensitive host path)" ;;
                esac ;;
            --mount)
                case "$arg" in
                    *source=/:*|*src=/:*|*source=/etc*|*src=/etc*|*source=/root*|*src=/root*|*source=/home*|*src=/home*|*source=/var/run/docker.sock*|*src=/var/run/docker.sock*)
                        deny "$prev $arg (sensitive host path)" ;;
                esac ;;
        esac
        prev="$arg"
    done
fi

exec "$REAL_DOCKER" "$@"
