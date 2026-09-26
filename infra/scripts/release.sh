#!/usr/bin/env bash
# Runs on Vultr. Image is already pulled; never builds on the production host.
set -Eeuo pipefail
release=${1:?Release directory required}
image=${2:?Immutable image reference required}
[[ "$release" =~ ^/opt/reefatlas/releases/[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 2
[[ "$image" =~ ^ghcr.io/vjl0/owlhack-2026/web@sha256:[a-f0-9]{64}$ ]] || exit 2
exec 9>/opt/reefatlas/.deploy.lock
flock -w 300 9
previous=$(readlink -f /opt/reefatlas/current || true)
[[ -f "$previous/compose.yaml" ]] || previous=/opt/reefatlas/infra
compose() { docker compose --project-name reefatlas --env-file "$1/.env" -f "$1/compose.yaml" "${@:2}"; }
printf 'DOMAIN=reefatlas.us\nWEB_IMAGE=%s\n' "$image" > "$release/.env"
compose "$release" config --quiet
compose "$release" run --rm --no-deps -T --interactive=false caddy caddy validate --config /etc/caddy/Caddyfile
rollback() {
  trap - ERR
  echo "Release failed; restoring $previous" >&2
  compose "$release" logs --tail=40 || true
  if compose "$previous" up -d --no-build --wait --wait-timeout 180; then
    echo 'Previous release restored.' >&2
  else
    echo 'ROLLBACK FAILED: manual intervention required.' >&2
  fi
  exit 1
}
trap rollback ERR
compose "$release" up -d --no-build --wait --wait-timeout 180
curl --fail --retry 10 --retry-all-errors --retry-delay 3 --max-time 10 https://reefatlas.us/api/health
ln -sfn "$previous" /opt/reefatlas/previous
ln -sfn "$release" /opt/reefatlas/current
trap - ERR
compose "$release" ps
