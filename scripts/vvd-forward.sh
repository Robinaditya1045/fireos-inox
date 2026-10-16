#!/usr/bin/env bash
# Makes the local Inox API reachable inside the VVD as localhost:18080 (reverse port forward).
# Re-run after every VVD restart. Verified 2026-10-16: the VVD can also reach the host via its
# LAN IP and 10.0.2.2, but localhost keeps asset URLs identical for the VVD and the host browser.
set -euo pipefail
# shellcheck disable=SC1090
source ~/vega/env
vega device start-port-forwarding --port 18080 --forward false
