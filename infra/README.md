# Reef Atlas deployment

Production: https://reefatlas.us on Vultr Ubuntu 26.04 at 66.135.11.15.
Next.js 16 standalone / Node 24 LTS runs behind Caddy with automatic HTTPS.
DNS and Porkbun require no changes. There is no Vultr API key in CI.

## Automatic deployment

Push or merge into `main`. `.github/workflows/deploy.yml`:

1. Builds the committed source on a GitHub-hosted Ubuntu 24.04 amd64 runner.
   The existing Dockerfile installs pnpm's frozen lockfile and runs the Next.js
   production build, including TypeScript validation and Cesium asset copying.
2. Publishes `ghcr.io/vjl0/owlhack-2026/web:<commit>` using the job-scoped
   `GITHUB_TOKEN`, with BuildKit provenance and SBOM, and GitHub cache API v2.
3. Smoke-tests the published digest with the production filesystem restrictions.
4. Uses the `production` environment (only the `main` branch is permitted), SSH
   host key verification, and a dedicated Ed25519 deployment key to connect.
5. Pulls the exact digest with a temporary Docker auth directory and the current
   job token. Credentials are deleted when the pull exits; no long-lived PAT.
6. Validates Caddy, starts the prebuilt image with Compose `--wait`, verifies
   public HTTPS health, and points `/opt/reefatlas/current` at the successful release.
   On startup/health failure it restores the preceding Compose configuration.

Actions are pinned to verified release commit SHAs. Dependabot proposes weekly
updates for actions, the Node Docker image, and Compose images; it does not merge
updates automatically. Production SSH secrets are unavailable to the build job.
Workflow concurrency and a server-side `flock` serialize deployments. A queued run
may be replaced by a newer push; in-progress deployments are not cancelled.

## CLI operations

```bash
# Deploy current main again (local uncommitted changes are not deployed)
./infra/scripts/deploy.sh
# Inspect or follow the workflow
gh run list --repo VJL0/owlhack-2026 --workflow deploy.yml
gh run watch <run-id> --repo VJL0/owlhack-2026 --exit-status
# Inspect production
ssh -i ~/.ssh/reefatlas deploy@66.135.11.15
cd /opt/reefatlas/current
docker compose ps
docker compose logs --tail=100 web caddy
```

## Rollback

Prefer reverting the faulty commit and pushing to `main`, which produces an audited
new deployment. For an emergency while no deployment is running, SSH in and run:

```bash
flock /opt/reefatlas/.deploy.lock bash -c '
  set -e
  target=$(readlink -f /opt/reefatlas/previous)
  docker compose -p reefatlas --env-file "$target/.env" -f "$target/compose.yaml" up -d --no-build --wait --wait-timeout 180
  curl --fail https://reefatlas.us/api/health
  ln -sfn "$target" /opt/reefatlas/current
'
```

Release configurations and pulled images are retained for rollback. Monitor disk
usage (`df -h`, `docker system df`) and remove old releases/images deliberately;
never prune an image needed by current/previous releases. Do not delete the
`reefatlas_caddy_data` volume: it contains certificates and the ACME account.
Back it up before server migration. Never run `docker compose down -v` in production.
This single-server deployment can briefly interrupt requests when containers are
replaced. It does not claim zero downtime or resilience to loss of the server.

## Configuration and credentials

- `production` secret `DEPLOY_SSH_KEY`: dedicated private key, set via `gh secret set`.
- `production` variable `DEPLOY_KNOWN_HOSTS`: server Ed25519 public host key, read
  through the previously trusted admin SSH connection, not trusted on first use in CI.
- CI public key in deploy's `authorized_keys` uses OpenSSH `restrict` to disable
  forwarding and PTY allocation. Docker group membership still grants root-equivalent
  power: repository writers able to change main must be trusted as deploy operators.
- `WEB_IMAGE` in each release `.env` selects the immutable digest; the fallback
  `reefatlas-web:latest` supports the original local stack and first rollback.
- `server-bootstrap.sh` and `vultr-firewall.sh` are first-server provisioning tools;
  CI does not provision servers or modify firewalls.
- Local container test: from `infra`, run
  `docker compose -f compose.yaml -f compose.local.yaml up --build`.
- The CSP includes inline/eval allowances required by the current app; it is not
  a nonce-based strict CSP. TigerData runtime secrets are read from `/opt/reefatlas/secrets/tiger.env`; see [TigerData setup](../apps/web/database/README.md).

## Official documentation researched September 26, 2026

| Technology | Documentation used |
| --- | --- |
| GitHub Actions | [Security and SHA pinning](https://docs.github.com/en/actions/reference/security/secure-use), [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments), [environment REST API](https://docs.github.com/en/rest/deployments/environments), [runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [manual CLI dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) |
| GHCR | [Container registry and GITHUB_TOKEN](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) |
| Docker Buildx | [GitHub Actions cache API v2](https://docs.docker.com/build/ci/github-actions/cache/), [SBOM and provenance](https://docs.docker.com/build/ci/github-actions/attestations/) |
| Docker Engine / Compose | [Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Compose up and wait](https://docs.docker.com/reference/cli/docker/compose/up/), [Next.js container guide](https://docs.docker.com/guides/nextjs/) |
| Node / pnpm | [Node release lifecycle](https://nodejs.org/en/about/previous-releases), [pnpm frozen installs](https://pnpm.io/cli/install) |
| Next.js | [Self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [deployment](https://nextjs.org/docs/app/getting-started/deploying) |
| Caddy | [Docker Compose operations](https://caddyserver.com/docs/running#docker-compose), [automatic HTTPS](https://caddyserver.com/docs/automatic-https) |
| Vultr | [Firewall rules](https://docs.vultr.com/products/network/firewall-groups/management/rules) |
| OpenSSH | [Authorized key restrictions](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT) |
| Dependabot | [Configuration reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) |

Action releases were resolved with `gh api repos/<owner>/<action>/releases/latest`
and verified through `gh api repos/<owner>/<action>/commits/<tag>`:
checkout v7.0.1, setup-buildx v4.4.1, login v4.6.0, build-push v7.4.0.
