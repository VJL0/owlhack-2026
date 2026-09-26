# syntax=docker/dockerfile:1

# Reef Sentinel web: Next.js 16 standalone server.
# Follows vercel/next.js examples/with-docker and Docker's Next.js guide:
# multi-stage, frozen lockfile, cache mounts, non-root runtime.

ARG NODE_VERSION=24.21.0-slim

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION} AS dependencies
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable pnpm && pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# prebuild copies the Cesium runtime (workers, assets, widgets) into public/cesium
RUN --mount=type=cache,target=/app/.next/cache \
    corepack enable pnpm && pnpm build

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
