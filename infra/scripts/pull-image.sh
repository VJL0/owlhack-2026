#!/usr/bin/env bash
# GitHub job token arrives on stdin, is used only for this pull, then removed.
set -euo pipefail
actor=${1:?GitHub actor required}
image=${2:?Image digest required}
[[ "$actor" =~ ^[a-zA-Z0-9_-]+(\[bot\])?$ ]] || exit 2
[[ "$image" =~ ^ghcr.io/vjl0/owlhack-2026/web@sha256:[a-f0-9]{64}$ ]] || exit 2
auth=$(mktemp -d)
trap 'rm -rf "$auth"' EXIT
chmod 700 "$auth"
docker --config "$auth" login ghcr.io --username "$actor" --password-stdin
docker --config "$auth" pull "$image"
