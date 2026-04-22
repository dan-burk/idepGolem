#!/bin/bash
# Deny-list egress: allow public internet, block lateral movement + cloud metadata.
# Must run as root. Invoked by entrypoint.sh at container start.
# Requires NET_ADMIN capability (set via cap_add in docker-compose.yml).
#
# Rationale: the container's blast radius is tightly bounded by other layers (no sudo,
# no privileged groups, narrow credential mount, RO .devcontainer, socket-proxy API
# filtering). Restricting outbound 443 adds friction for Claude's WebFetch/WebSearch
# without materially reducing risk — the host-escape paths that matter don't rely on
# public-internet egress. The denies below still prevent the things that DO matter:
# reaching other containers/services on this Docker host, and reading cloud metadata.
#
# NOTE: this is IPv4 only. If the container ever gets IPv6 connectivity, v6 traffic
# is unfiltered. Docker typically doesn't enable v6 in containers; confirm with
# `ip -6 addr` inside the container if worried.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "init-firewall: must run as root" >&2
    exit 1
fi

# Flush only the filter table. nat/mangle contain Docker's DNAT rules for embedded
# DNS (127.0.0.11) and must be left alone.
iptables -F
iptables -X

# Default deny.
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Loopback (also covers Docker embedded DNS at 127.0.0.11).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Established/related (replies to our outbound traffic).
iptables -A INPUT  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Socket proxy (docker-proxy) on the internal compose bridge. Compose picks a
# subnet from RFC1918 space, so we allow port 2375 to any of those. The blanket
# REJECTs below land AFTER this, so these specific ACCEPTs win.
iptables -A OUTPUT -d 172.16.0.0/12  -p tcp --dport 2375 -j ACCEPT
iptables -A OUTPUT -d 10.0.0.0/8     -p tcp --dport 2375 -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -p tcp --dport 2375 -j ACCEPT

# Block lateral movement and cloud metadata. These must come BEFORE the final
# blanket ACCEPT, but AFTER the proxy allow above.
iptables -A OUTPUT -d 10.0.0.0/8     -j REJECT
iptables -A OUTPUT -d 172.16.0.0/12  -j REJECT
iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT
iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT  # link-local + cloud instance metadata
iptables -A OUTPUT -d 100.64.0.0/10  -j REJECT  # carrier-grade NAT, sometimes used for metadata
iptables -A OUTPUT -d 127.0.0.0/8    -j REJECT  # belt-and-suspenders vs. non-lo loopback routing

# DNS (any destination, ports 53 UDP/TCP).
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Everything else (public internet) is allowed.
iptables -A OUTPUT -j ACCEPT

echo "init-firewall: deny-list policy applied"
