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

## Speech Engine (Gemini remains the agent)

The `speech` service runs the ElevenLabs TypeScript SDK on port 3001 alongside
Next.js. Caddy exposes only `wss://reefatlas.us/voice-engine`, rewriting it to
`/ws`. The SDK authenticates incoming ElevenLabs connections; do not disable auth.
The service's HTTP session API stays on the Docker network, behind Next.js's
same-origin `/api/voice/session` route. Each browser receives a temporary WebRTC
conversation token and a random session capability for context/actions. The API
key is never returned to the browser.

Before deploying this change:

1. In `apps/web/.env.local`, set `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and
   `SPEECH_PUBLIC_WS_URL=wss://reefatlas.us/voice-engine`.
2. Run `pnpm speech:setup` from `apps/web`. This creates a **Speech Engine**
   resource (not an ElevenAgents agent), enabling the
   first-message override for scene narration, and selecting required client events.
   Set the printed `ELEVENLABS_SPEECH_ENGINE_ID=seng_…` in `.env.local`.
   Running the command with an existing ID updates that resource instead and
   preserves its dashboard voice unless `ELEVENLABS_VOICE_ID` is explicitly set.
3. Provision `/opt/reefatlas/secrets/voice.env` on Vultr with
   `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, and any
   existing Gemini model overrides. Keep this file private. Compose reads it for
   both services. It is required for the new speech service to become healthy.
4. Deploy through the existing main-branch workflow. No additional public port
   or firewall change is needed. Caddy allows ElevenLabs WebRTC connections in CSP.

For local development, run `pnpm dev` and `pnpm speech:dev` from `apps/web` in
separate terminals. ElevenLabs must reach the local Speech Engine process through
an HTTPS tunnel: set a development engine's `SPEECH_PUBLIC_WS_URL` to that tunnel's
`wss://…/ws` URL and run `pnpm speech:setup`. Use a separate development engine ID
so testing doesn't redirect production traffic. Local Compose accepts
`VOICE_ENV_FILE=/absolute/path/to/voice.env`.

Press V or click the microphone once to start a continuous conversation. Speak
naturally; ElevenLabs detects turns and interrupts playback on barge-in. Press V
again or close the panel to end it. Typed questions still use `/api/voice/ask`
when voice is disconnected or unavailable; during a voice session they use the
SDK's text input. Scene narration and replay also go through Speech Engine;
starting the spoken guide may ask for microphone permission (the guide starts
muted until the user enables conversation).

Gemini's full tool loop streams text, retains thought signatures and function
responses, and receives the SDK's abort signal. Cancelled turns cannot publish
pending navigation actions. Existing data/page tool implementations are unchanged.
The agent's data tools read Tiger Cloud (`src/server/reef/tigerReefData.ts`), so the
`speech` container needs the same `tiger.env` as `web` (Compose already loads it).

Validation: `pnpm test:voice`, `pnpm typecheck`, and `pnpm build`. After deployment,
verify a spoken reef question, a page-navigation command, a follow-up using
"this reef", barge-in during a long reply, typed fallback with microphone denied,
and closing/reopening the session. A real audio test requires ElevenLabs
credentials, a configured engine, and the public WebSocket endpoint.

Official references used September 27, 2026:
[Speech Engine quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine),
[server SDK](https://elevenlabs.io/docs/eleven-api/resources/libraries/speech-engine/javascript-sdk-reference),
[upstream protocol](https://elevenlabs.io/docs/api-reference/speech-engine/speech-engine-upstream),
[conversation tokens](https://elevenlabs.io/docs/api-reference/conversations/get-webrtc-token),
[React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react).
The shared token API calls its resource parameter `agentId`; it accepts the
Speech Engine `seng_…` ID and does not move the Gemini agent to ElevenAgents.
